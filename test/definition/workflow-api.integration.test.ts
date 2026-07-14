import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import type postgres from "postgres";
import {
  applyMigrations,
  canonical,
  connectDatabase,
  getWorkflow,
  importWorkflow,
  listWorkflows,
  mutate,
  reverseObjectKeys,
  sha256,
  validDefinition,
} from "./helpers";

const databaseSuite = process.env.DATABASE_URL ? describe : describe.skip;

databaseSuite("M0-T03/T04 API and PostgreSQL versioning", () => {
  let sql: ReturnType<typeof postgres>;
  let bindingsDirectory: string;

  beforeAll(async () => {
    process.env.PROVIDER_BINDINGS_FILE ??= `${process.cwd()}/config/provider-bindings.example.json`;
    process.env.FAKE_PROVIDER_API_KEY = "PR3_TEST_SECRET_DO_NOT_LEAK";
    bindingsDirectory = await mkdtemp(path.join(tmpdir(), "workflow-pr3-bindings-"));
    sql = connectDatabase();
    await applyMigrations(sql);
  });

  afterAll(async () => {
    await sql?.end({ timeout: 1 });
    await rm(bindingsDirectory, { force: true, recursive: true });
  });

  async function withBindingsFile<T>(
    file: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = process.env.PROVIDER_BINDINGS_FILE;
    process.env.PROVIDER_BINDINGS_FILE = file;
    vi.resetModules();
    try {
      return await operation();
    } finally {
      if (previous === undefined) delete process.env.PROVIDER_BINDINGS_FILE;
      else process.env.PROVIDER_BINDINGS_FILE = previous;
      vi.resetModules();
    }
  }

  async function expectNoPersistedDefinition(name: string) {
    const [counts] = await sql`
      SELECT
        (SELECT count(*)::int FROM workflows WHERE name = ${name}) AS workflows,
        (
          SELECT count(*)::int
          FROM workflow_definition_versions version
          JOIN workflows workflow ON workflow.id = version.workflow_id
          WHERE workflow.name = ${name}
        ) AS versions
    `;
    expect(counts).toEqual({ workflows: 0, versions: 0 });
  }

  test("POST import persists canonical JSON/SHA-256 and versions repeated content", async () => {
    const definition = validDefinition(`import-${randomUUID()}`);
    const first = await importWorkflow(definition);
    const second = await importWorkflow(definition);
    const firstBody = await first.json();
    const secondBody = await second.json();

    expect([first.status, second.status]).toEqual([201, 201]);
    expect(firstBody).toMatchObject({
      workflow: { id: expect.any(String), name: definition.metadata.name },
      workflowDefinitionVersion: {
        id: expect.any(String), version: 1, hash: expect.stringMatching(/^[0-9a-f]{64}$/), definition,
      },
    });
    expect(secondBody.workflow.id).toBe(firstBody.workflow.id);
    expect(secondBody.workflowDefinitionVersion).toMatchObject({ version: 2, hash: firstBody.workflowDefinitionVersion.hash });
    expect(secondBody.workflowDefinitionVersion.id).not.toBe(firstBody.workflowDefinitionVersion.id);

    const [stored] = await sql`
      SELECT canonical_json, hash FROM workflow_definition_versions
      WHERE id = ${firstBody.workflowDefinitionVersion.id}
    `;
    expect(stored.canonical_json).toBe(canonical(definition));
    expect(stored.hash).toBe(sha256(canonical(definition)));
  });

  test("recursive object-key order is stable while array order changes the hash", async () => {
    const original = validDefinition(`canonical-${randomUUID()}`);
    const reversedObjects = reverseObjectKeys(original);
    const reversedArray = structuredClone(original);
    reversedArray.spec.nodes.reverse();
    const responses = [];
    for (const definition of [original, reversedObjects, reversedArray]) {
      responses.push(await importWorkflow(definition));
    }
    const bodies = await Promise.all(responses.map((response) => response.json()));

    expect(responses.map((response) => response.status)).toEqual([201, 201, 201]);
    expect(bodies.map((body) => body.workflowDefinitionVersion.version)).toEqual([1, 2, 3]);
    expect(bodies[1].workflowDefinitionVersion.hash).toBe(bodies[0].workflowDefinitionVersion.hash);
    expect(bodies[2].workflowDefinitionVersion.hash).not.toBe(bodies[0].workflowDefinitionVersion.hash);
  });

  test("concurrent same-name imports allocate contiguous unique versions", async () => {
    const definition = validDefinition(`concurrent-${randomUUID()}`);
    const responses = await Promise.all(Array.from({ length: 8 }, () => importWorkflow(definition)));
    const bodies = await Promise.all(responses.map((response) => response.json()));

    expect(responses.every((response) => response.status === 201)).toBe(true);
    expect(new Set(bodies.map((body) => body.workflow.id)).size).toBe(1);
    expect(bodies.map((body) => body.workflowDefinitionVersion.version).sort((a, b) => a - b))
      .toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  test("invalid imports are transactional, create zero rows, and consume no version", async () => {
    const name = `atomic-${randomUUID()}`;
    const invalid = mutate((definition) => {
      definition.spec.nodes[1].config.provider = "forbidden";
    }, name);
    const invalidFirst = await importWorkflow(invalid);
    expect(invalidFirst.status).toBe(400);
    expect(await invalidFirst.json()).toMatchObject({
      code: "validation_error", path: "spec.nodes[1].config.provider", nodeId: "analyze",
    });
    expect((await sql`SELECT count(*)::int AS count FROM workflows WHERE name = ${name}`)[0].count).toBe(0);

    const first = await importWorkflow(validDefinition(name));
    const invalidBetween = await importWorkflow(invalid);
    const second = await importWorkflow(validDefinition(name));
    expect([first.status, invalidBetween.status, second.status]).toEqual([201, 400, 201]);
    expect((await first.json()).workflowDefinitionVersion.version).toBe(1);
    expect((await second.json()).workflowDefinitionVersion.version).toBe(2);
  });

  test("reference failures and malformed JSON return exact validation envelopes", async () => {
    for (const [field, value] of [
      ["agentVersionRef", "missing-agent-v1"],
      ["providerBindingRef", "missing-binding"],
    ]) {
      const response = await importWorkflow(mutate((definition) => {
        definition.spec.nodes[1].config[field] = value;
      }));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        code: "validation_error", path: `spec.nodes[1].config.${field}`, nodeId: "analyze",
      });
    }
    const malformed = await importWorkflow('{"kind":');
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ code: "validation_error", path: "", nodeId: null });
  });

  test("GET list/detail expose latest versions, bootstrap parent included, and detail 404s", async () => {
    const definition = validDefinition(`read-${randomUUID()}`);
    await importWorkflow(definition);
    const latest = await importWorkflow(definition);
    const latestBody = await latest.json();
    const list = await listWorkflows();
    const listBody = await list.json();

    expect(list.status).toBe(200);
    expect(listBody.workflows.length).toBeGreaterThan(0);
    expect(listBody.workflows.every((workflow: any) =>
      typeof workflow.id === "string" &&
      typeof workflow.latestDefinitionVersion?.id === "string" &&
      Number.isInteger(workflow.latestDefinitionVersion?.version) &&
      /^[0-9a-f]{64}$/.test(workflow.latestDefinitionVersion?.hash),
    )).toBe(true);

    const detail = await getWorkflow(latestBody.workflow.id);
    expect(detail.status).toBe(200);
    expect(await detail.json()).toEqual({
      workflow: latestBody.workflow,
      workflowDefinitionVersion: latestBody.workflowDefinitionVersion,
    });
    expect((await getWorkflow(`missing-${randomUUID()}`)).status).toBe(404);
  });

  test("Workflow/Agent Versions reject update/delete and protect parents", async () => {
    const response = await importWorkflow(validDefinition(`immutable-${randomUUID()}`));
    const body = await response.json();
    await expect(sql`UPDATE workflow_definition_versions SET version = 99 WHERE id = ${body.workflowDefinitionVersion.id}`).rejects.toThrow();
    await expect(sql`DELETE FROM workflow_definition_versions WHERE id = ${body.workflowDefinitionVersion.id}`).rejects.toThrow();
    await expect(sql`DELETE FROM workflows WHERE id = ${body.workflow.id}`).rejects.toThrow();

    const [agentVersion] = await sql`
      SELECT id, agent_definition_id, version, canonical_json, hash
      FROM agent_definition_versions WHERE id = 'seed-agent-v1'
    `;
    expect(agentVersion).toMatchObject({
      id: "seed-agent-v1", version: 1, canonical_json: expect.any(String), hash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    await expect(sql`UPDATE agent_definition_versions SET version = 99 WHERE id = 'seed-agent-v1'`).rejects.toThrow();
    await expect(sql`DELETE FROM agent_definition_versions WHERE id = 'seed-agent-v1'`).rejects.toThrow();
    await expect(sql`DELETE FROM agent_definitions WHERE id = ${agentVersion.agent_definition_id}`).rejects.toThrow();
  });

  test("workflow APIs never expose binding URL, API-key metadata, or secret values", async () => {
    const imported = await importWorkflow(validDefinition(`redact-${randomUUID()}`));
    const body = await imported.json();
    const missingBinding = await importWorkflow(mutate((definition) => {
      definition.spec.nodes[1].config.providerBindingRef = "missing-binding";
    }));
    const serialized = JSON.stringify([
      body,
      await (await listWorkflows()).json(),
      await (await getWorkflow(body.workflow.id)).json(),
      await missingBinding.json(),
    ]);
    for (const forbidden of [
      "PR3_TEST_SECRET_DO_NOT_LEAK", "http://fake-provider:4010/v1", "FAKE_PROVIDER_API_KEY",
      '"baseUrl"', '"apiKey"', '"apiKeyEnv"',
    ]) expect(serialized).not.toContain(forbidden);
  });

  test("a valid bindings file with an absent alias remains a field validation error", async () => {
    const file = path.join(bindingsDirectory, "valid-missing-alias.json");
    await writeFile(file, JSON.stringify({
      bindings: {
        configured: {
          provider: "openai-compatible",
          baseUrl: "https://sensitive-provider.internal/v1",
          apiKeyEnv: "FAKE_PROVIDER_API_KEY",
          model: "fake-m0",
          parameters: { temperature: 0 },
        },
      },
    }));
    const name = `missing-alias-${randomUUID()}`;
    const response = await withBindingsFile(file, () => importWorkflow(mutate((definition) => {
      definition.spec.nodes[1].config.providerBindingRef = "missing-binding";
    }, name)));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({
      code: "validation_error",
      path: "spec.nodes[1].config.providerBindingRef",
      nodeId: "analyze",
    });
    expect(JSON.stringify(body)).not.toContain("sensitive-provider.internal");
    expect(JSON.stringify(body)).not.toContain(bindingsDirectory);
    await expectNoPersistedDefinition(name);
  });

  const baseBinding = {
    provider: "openai-compatible",
    baseUrl: "https://sensitive-provider.internal/v1",
    apiKeyEnv: "FAKE_PROVIDER_API_KEY",
    model: "fake-m0",
    parameters: { temperature: 0 },
  };
  const bindingConfigurationCases: Array<[
    string,
    (directory: string) => Promise<string>,
  ]> = [
    ["missing file", async (directory) => path.join(directory, `missing-${randomUUID()}.json`)],
    ["unreadable file", async (directory) => {
      const file = path.join(directory, `directory-not-file-${randomUUID()}`);
      await mkdir(file);
      return file;
    }],
    ["malformed JSON", async (directory) => {
      const file = path.join(directory, `malformed-${randomUUID()}.json`);
      await writeFile(file, '{"leak":"CONFIG_SECRET_DO_NOT_LEAK"');
      return file;
    }],
    ["null alias", async (directory) => {
      const file = path.join(directory, `null-alias-${randomUUID()}.json`);
      await writeFile(file, JSON.stringify({ bindings: { "fake-default": null } }));
      return file;
    }],
    ["invalid field", async (directory) => {
      const file = path.join(directory, `invalid-field-${randomUUID()}.json`);
      await writeFile(file, JSON.stringify({
        bindings: { "fake-default": { ...baseBinding, baseUrl: 42 } },
      }));
      return file;
    }],
    ["null field", async (directory) => {
      const file = path.join(directory, `null-field-${randomUUID()}.json`);
      await writeFile(file, JSON.stringify({
        bindings: { "fake-default": { ...baseBinding, model: null } },
      }));
      return file;
    }],
    ["missing field", async (directory) => {
      const file = path.join(directory, `missing-field-${randomUUID()}.json`);
      await writeFile(file, JSON.stringify({
        bindings: { "fake-default": { ...baseBinding, provider: undefined } },
      }));
      return file;
    }],
  ];

  test.each(bindingConfigurationCases)(
    "invalid server binding configuration: %s returns redacted 5xx and persists nothing",
    async (label, createFixture) => {
      const file = await createFixture(bindingsDirectory);
      const name = `config-error-${randomUUID()}`;
      const response = await withBindingsFile(file, () =>
        importWorkflow(validDefinition(name)));
      const body = await response.text();

      expect(response.status, label).toBeGreaterThanOrEqual(500);
      expect(response.status, label).toBeLessThan(600);
      expect(body, label).not.toContain("validation_error");
      expect(body, label).not.toContain(bindingsDirectory);
      expect(body, label).not.toContain("CONFIG_SECRET_DO_NOT_LEAK");
      expect(body, label).not.toContain("PR3_TEST_SECRET_DO_NOT_LEAK");
      expect(body, label).not.toContain("sensitive-provider.internal");
      expect(body, label).not.toContain("ENOENT");
      expect(body, label).not.toContain("EISDIR");
      expect(body, label).not.toContain("SyntaxError");
      expect(body, label).not.toContain("Unexpected end of JSON input");
      await expectNoPersistedDefinition(name);
    },
  );
});
