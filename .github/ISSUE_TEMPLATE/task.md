---
name: Task
about: Manual work that must happen before a decision can be made
labels:
  - wayfinder:task
title: ""
body:
  - type: textarea
    id: question
    attributes:
      label: Question
      description: The work that needs to be done and the decision it unblocks
    validations:
      required: true
  - type: textarea
    id: blocked-by
    attributes:
      label: Blocked by
      description: List issue numbers that must be resolved first (e.g. "#17")
    validations:
      required: false
---

## Question

<the work that needs to be done and the decision it unblocks>

## Blocked by

<list issue numbers, e.g. #17>
