---
title: Declarative apply
description: projects.apply and the project_apply MCP tool create or update a whole lab from one manifest, idempotently.
---

`projects.apply` replaces a hundred sequential calls with one manifest. Nodes are addressed by name,
templates by name or id, and ports are selected automatically unless you name them. The same
manifest can be sent again without creating duplicates.

## A manifest

```json
{
  "name": "ccna-lab",
  "nodes": [
    { "name": "sw1", "template": "Ethernet switch" },
    { "name": "sw2", "template": "Ethernet switch" },
    {
      "name": "r1",
      "template": "Cisco IOU L3",
      "files": [{ "path": "startup-config.cfg", "content": "hostname r1\n" }]
    }
  ],
  "links": [
    { "a": "sw1", "b": "r1" },
    { "a": "sw2", "b": "r1", "type": "ethernet" }
  ],
  "drawings": [{ "key": "title", "type": "text", "text": "CCNA lab", "x": 40, "y": 20 }],
  "prune": false,
  "start": false
}
```

Omit `projectId` to find or create a project by `name`. That path requires a global `project.write`
because authorization resolves the project before the service lookup. Project-scoped roles and
project-restricted API keys must pass `projectId`.

## What is idempotent

| Object   | Identity                          | Second apply                     |
| -------- | --------------------------------- | -------------------------------- |
| Node     | name inside the project           | updates supplied fields          |
| File     | `path` inside one node            | rewritten                        |
| Link     | unordered node pair + type        | reused; style updated if supplied |
| Drawing  | `style.applyKey`                  | updated in place                 |

Unkeyed drawings are never matched and never pruned. Node names, templates, computes, and emulator
types are never changed by apply: an existing node that asks for a different type or compute fails
with `CONFLICT`. Send a new node instead.

## Prune and start

- `prune: true` deletes nodes, links, and keyed drawings that the manifest no longer lists.
  Unkeyed drawings are left alone. Deletion also removes links touching a deleted node.
- `start: true` starts every manifest node once the project is open. Both flags default to `false`.

Apply opens the project before creating links, because link dataplanes need namespaces and slots.

## Ports

Explicit ports use the exact names from the node's port list (`Ethernet0`, `Ethernet0/0`, …) via
`aPort`/`bPort`. Supply both or neither. A name already used by another link is a conflict, except
when apply is reusing the existing link that owns it. Otherwise the first free port of the link
type is chosen on each node; port exhaustion is an error, not a silent skip.

## Preflight and privileges

Deterministic problems are checked before any mutation: unknown nodes or templates, ambiguous
template names, duplicate manifest names, unsafe file paths, duplicate file paths in one node,
files on a started node (`NODE_BUSY`), and missing privileges. An agent failure after mutations can
still leave a partial project — apply is not a distributed transaction.

Besides `project.write`, the caller needs the privileges of the operations involved:
`node.create`, `node.update`, `node.files`, `link.write`, `drawing.write`, `node.delete` for pruning,
and `node.control` for `start`.

## From MCP

The same operation is exposed as the tool `project_apply`. The tool is marked destructive because a
prune can delete rows; MCP clients should require confirmation before calling it with `prune: true`.
See [MCP & agents](/mcp) for the request shape.

## Return value

`ProjectApplyResult` contains the project row, per-node results (`created`, `updated`, final
status), per-link and per-drawing results, the `deleted` arrays, and the list of started node names.
Use it to report what changed instead of re-listing the project.
