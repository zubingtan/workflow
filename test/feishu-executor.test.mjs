import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { genWebhookSign, buildMessageBody, resolveTemplateValue } from "../server/feishu-executor.mjs";

describe("genWebhookSign", () => {
  test("produces a base64 string for given timestamp and secret", () => {
    const sig = genWebhookSign(1599360473, "test-secret");
    assert.equal(typeof sig, "string");
    assert.ok(sig.length > 0);
    // Should be valid base64
    assert.doesNotThrow(() => Buffer.from(sig, "base64"));
  });

  test("produces deterministic output for same inputs", () => {
    const sig1 = genWebhookSign(1599360473, "test-secret");
    const sig2 = genWebhookSign(1599360473, "test-secret");
    assert.equal(sig1, sig2);
  });

  test("produces different output for different secrets", () => {
    const sig1 = genWebhookSign(1599360473, "secret-a");
    const sig2 = genWebhookSign(1599360473, "secret-b");
    assert.notEqual(sig1, sig2);
  });

  test("produces different output for different timestamps", () => {
    const sig1 = genWebhookSign(1599360473, "test-secret");
    const sig2 = genWebhookSign(1599360474, "test-secret");
    assert.notEqual(sig1, sig2);
  });
});

describe("buildMessageBody", () => {
  test("text message without secret (webhook)", () => {
    const body = buildMessageBody({
      botType: "webhook",
      msgType: "text",
      textContent: "Hello world",
    });
    assert.deepEqual(body, {
      msg_type: "text",
      content: { text: "Hello world" },
    });
  });

  test("text message with signature (webhook + secret)", () => {
    const body = buildMessageBody({
      botType: "webhook",
      msgType: "text",
      textContent: "Hello",
      secret: "my-secret",
    });
    assert.equal(body.msg_type, "text");
    assert.deepEqual(body.content, { text: "Hello" });
    assert.ok(body.timestamp, "should have timestamp");
    assert.ok(body.sign, "should have sign");
    assert.equal(typeof body.sign, "string");
    // Verify sign matches the timestamp
    const expectedSign = genWebhookSign(Number(body.timestamp), "my-secret");
    assert.equal(body.sign, expectedSign);
  });

  test("app bot text message should not include timestamp/sign", () => {
    const body = buildMessageBody({
      botType: "app",
      msgType: "text",
      textContent: "Hello",
      secret: "unused",
    });
    assert.equal(body.timestamp, undefined);
    assert.equal(body.sign, undefined);
    assert.deepEqual(body, {
      msg_type: "text",
      content: { text: "Hello" },
    });
  });

  test("post message parses JSON content", () => {
    const postContent = JSON.stringify({
      zh_cn: {
        title: "Test",
        content: [[{ tag: "text", text: "hello" }]],
      },
    });
    const body = buildMessageBody({
      botType: "webhook",
      msgType: "post",
      postContent,
    });
    assert.equal(body.msg_type, "post");
    assert.ok(body.content.post);
    assert.equal(body.content.post.zh_cn.title, "Test");
  });

  test("interactive card message parses JSON content", () => {
    const cardContent = JSON.stringify({
      schema: "2.0",
      header: { title: { tag: "plain_text", content: "Card Title" } },
    });
    const body = buildMessageBody({
      botType: "webhook",
      msgType: "interactive",
      cardContent,
    });
    assert.equal(body.msg_type, "interactive");
    assert.ok(body.card);
    assert.equal(body.card.schema, "2.0");
    assert.equal(body.card.header.title.content, "Card Title");
  });

  test("invalid post JSON throws error", () => {
    assert.throws(
      () =>
        buildMessageBody({
          botType: "webhook",
          msgType: "post",
          postContent: "not valid json",
        }),
      /JSON/,
    );
  });

  test("unsupported msg type throws error", () => {
    assert.throws(
      () =>
        buildMessageBody({
          botType: "webhook",
          msgType: "unknown",
          textContent: "hello",
        }),
      /Unsupported message type/,
    );
  });
});

describe("resolveTemplateValue", () => {
  test("returns string as-is", () => {
    assert.equal(resolveTemplateValue("hello"), "hello");
  });

  test("extracts content from template object", () => {
    assert.equal(
      resolveTemplateValue({ type: "template", content: "hello" }),
      "hello",
    );
  });

  test("extracts content from constant object", () => {
    assert.equal(
      resolveTemplateValue({ type: "constant", content: "world" }),
      "world",
    );
  });

  test("returns empty string for null/undefined", () => {
    assert.equal(resolveTemplateValue(null), "");
    assert.equal(resolveTemplateValue(undefined), "");
  });

  test("converts number to string", () => {
    assert.equal(resolveTemplateValue(42), "42");
  });
});
