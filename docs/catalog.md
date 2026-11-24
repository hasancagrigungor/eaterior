# Product catalogs (1.10.0)

A **catalog** is a JSON file in which a manufacturer, dealer or design studio lists its products: furniture,
kitchen equipment, HVAC units and decor. Editors show these products as ready-made components. Placing a product
creates an ordinary Eaterior object with a `product` reference.

- **Data only.** A catalog has no code. Anyone can publish one at any URL or serve one from their own service.
  The client (editor, POS, viewer) decides which catalogs to load.
- **Plans stay complete.** A placed product keeps its own size, kind, appearance and performance in the plan.
  The `product` reference only says which product it is. A plan opens and renders the same without the catalog.
- **Schema:** [`schemas/v1.10.0/catalog.schema.json`](../schemas/v1.10.0/catalog.schema.json).
  **Example:** [`examples/catalog.json`](../examples/catalog.json).

## Structure

```
format: "eaterior-catalog", schemaVersion: "1.10.0", id, name, version?, updatedAt?
publisher: { name, url?, logo?, verified? }
license?
items[]:
  id, name, brand?, type: table | fixture | climateDevice, category?, sku?, description?, tags?, url?, sponsored?
  template: { kind?, shape: rect | ellipse, widthM, depthM, heightM?, seats?, mount?, capabilities?,
              appearance?, chairStyle?, performance? }
  variants[]?: { id, name, sku?, widthM?, depthM?, seats?, appearance? }
  assets?: { thumbnail?, topView?, model3d?, datasheet?, cad? }
extensions?
```

- `template` holds the real size in metres plus the Eaterior fields the object gets. `kind` must be one of the
  kinds of that object type (`x-eaterior-kinds` in the schema lists them). `performance` applies to climate
  devices only.
- A `variant` overrides size, seat count or appearance (for example 70 cm and 80 cm versions of one table).
- `assets.topView` is a top-down drawing at the product's real size. Renderers draw it in place of the generic
  symbol (see below). `thumbnail` is the picture shown in the component list.
- `publisher.verified` and `sponsored` are set by the service that hosts the catalog. Clients SHOULD label
  sponsored items as sponsored.

## Product reference on objects

Tables, fixtures and climate devices may carry:

```json
"product": { "catalog": "acme-furniture", "item": "bistro-round-70", "variant": "oak",
             "version": "2026.11", "brand": "Acme", "name": "Bistro round table Oak", "sku": "BR-70-OAK",
             "url": "https://acme.example/bistro", "sponsored": false }
```

`catalog` and `item` are required. `catalog` is the catalog id or its URL.

## Checking a catalog

```bash
eaterior check-catalog catalog.json
```

The check reports schema errors and these codes: `duplicate_id` and `duplicate_variant`; `bad_kind`, when a kind
does not exist for the item type; `missing_kind`, when a fixture or climate device has no kind;
`performance_ignored` (warning), when a non-HVAC item has a performance block; `unsafe_url`, for non-http(s)
links; and `insecure_url` (warning), for http links. From Python, call `eaterior.check_catalog(doc)`.

## Using catalogs in JavaScript

```js
import { catalogItemToObject, buildScene } from "eaterior";
import { buildIllustratedScene } from "eaterior/illustrated";

const table = catalogItemToObject(item, {
  id: "t_12", floorId: "floor_1", at: [420, 310],    // centre, in floor units
  metersPerUnit: 0.02, variant: "oak", catalog: catalog.id, catalogVersion: catalog.version, number: "12",
});
floor.tables.push(table);

// Draw product top views instead of the generic symbols
const images = new Map(catalog.items.map((i) => [i.id, i.assets?.topView]));
const scene = buildIllustratedScene(plan, { resolveProductImage: (obj) => images.get(obj.product.item) ?? null });
```

In the illustrated theme, the image replaces the generic drawing of fixtures and climate devices. On tables it
covers the table top, and chairs and the table number stay. The plain theme draws the image over the outline.
Without `resolveProductImage`, or when it returns `null`, nothing changes.

## Hosting a catalog service

The format does not prescribe a server. A service only needs to serve the catalog JSON over HTTPS (with CORS
if browsers fetch it directly) and serve the asset files. A typical service:

- lets publishers sign up and upload products and files;
- reviews submissions before they become public, sets `publisher.verified` and decides which items are
  `sponsored`;
- serves each publisher's approved items as `GET /…/<publisher>/catalog.json`.

Clients should fetch only catalogs the user chose, over HTTPS, with size and time limits, and should run
`check-catalog` before showing items.
