# @jurfi/core

Runtime kernel for Jurfi: small math helpers and the entity-component world. This package does not import three.js or touch the DOM.

## Entity

An `Entity` is a 32-bit number. The low 20 bits are the slot index and the high 12 bits are the generation. `0` is null and is never alive. Generation `0` is not issued; after generation 4095 the next id uses generation 1, so a handle can theoretically alias only after a full wrap of that slot.

```ts
const entity = world.create();
world.isAlive(entity);
world.destroy(entity);
```

## Components

```ts
const Health = defineComponent('Health', {
  hp: { type: 'number', default: 0 },
});

world.add(entity, Health, { hp: 3 });
world.get(entity, Health);
world.set(entity, Health, { hp: 4 });
world.has(entity, Health);
world.remove(entity, Health);
world.getField(entity, Health, 'hp');
world.setField(entity, Health, 'hp', 5);
```

`defineComponent(id, schema, { storage })` accepts `sparse` (one object per entity) and `soa` (one column per lane). Storage defaults to `sparse`, except `Transform`, which defaults to `soa`. Field writes are checked against the schema: finite numbers, booleans, strings, entity ids, and vectors (`vec2`, `vec3`, `vec4`, `quat`, `color`). Vector lanes use a dotted path (`position.x`, `color.r`). A dotted write on a missing component creates it from defaults.

`Transform`, `Light`, and `Light2D` are built in. `Light2D` is its own component.

`getVariable` / `setVariable` is a JSON key/value map on the entity. Destroying an entity drops its components and variables, and the next occupant of that slot does not see them.

## World

`createWorld()` returns a `World` with:

| Member | Role |
| --- | --- |
| `create` / `destroy` / `isAlive` | Generational entity storage |
| `add` / `set` / `get` / `has` / `remove` | Components, by type or id |
| `getField` / `setField` | One schema field |
| `getVariable` / `setVariable` | Per-entity variables |
| `query` | Entities that have every requested component |
| `events` | `created`, `destroyed`, `added`, `removed`, `changed` |
| `time` | `tick(dt)`, `delta`, `elapsed`, `frame`, `scale` |
| `use` | Run a plugin once per id |
| `toScene` / `loadScene` | Scene JSON, including dead-slot generations |
| `renderScene` | `entities`, `worldMatrices`, `dirty`, and `view(component)` in parallel |
| `dispose` | Drop storage |

`renderScene()` lists alive entities in index order. `worldMatrices` holds column-major 4x4 matrices (16 floats each) computed from `Transform` and parent links. An entity without `Transform` contributes an identity matrix. `dirty[i]` is 1 when that world matrix changed since the previous extraction. `view(id)` returns component values aligned with `entities`.

## Editor and script adapters

`createEditorWorld(world?)` is the document shape `@jurfi/editor` calls `EditorWorld`: string ids, `name`, `parentId`, a JSON component bag, `serialize` / `deserialize`, and `subscribe`. Ids are aliases. Defined components are stored in the ECS; other bag keys stay as JSON so a bag like `{ health: -1 }` still round-trips. Rows read back from the world also carry `eid` (the packed entity id), `variables`, and the snapshot carries `generations`. `deserialize` restores those slots instead of allocating new ids, which is what play-mode `stop()` needs. Documents without `eid` still allocate fresh entities.

`createScriptWorld(world, self?)` is the `ScriptWorld` surface used by visual scripting: `getComponent`, `setComponent`, `hasComponent`, `getField`, `setField`, `getVariable`, and `setVariable`.
