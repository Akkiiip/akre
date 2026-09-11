import { useState } from "react";
import { MeasurementFields, measurementsFromForm } from "./MeasurementFields";
import type { Dataset } from "../shared/domain";
type Mutate = (
  path: string,
  method: string,
  body: unknown,
  message: string,
) => Promise<boolean>;
export function ProductCreate({ mutate }: { mutate: Mutate }) {
  return (
    <details className="record panel">
      <summary>Record a product opportunity from evidence</summary>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          await mutate(
            "/observations",
            "POST",
            {
              productName: f.get("name"),
              category: f.get("category"),
              sourceName: f.get("source"),
              reference: f.get("reference"),
              note: f.get("note"),
              measurements: measurementsFromForm(f),
            },
            "Source observation saved; discovery queued. Scores stay unavailable until normalized evidence is recorded.",
          );
        }}
      >
        <div className="formGrid">
          {[
            ["name", "Product name"],
            ["category", "Category"],
            ["source", "Source name"],
            ["reference", "Source URL"],
          ].map(([name, label]) => (
            <label className="field" key={name}>
              <span>{label}</span>
              <input
                name={name}
                type={name === "reference" ? "url" : "text"}
                required
              />
            </label>
          ))}
        </div>
        <label className="field">
          <span>Evidence note</span>
          <textarea name="note" required minLength={3} />
        </label>
        <MeasurementFields />
        <button>Record opportunity</button>
      </form>
    </details>
  );
}
export function OfferCreate({ d, mutate }: { d: Dataset; mutate: Mutate }) {
  const [productId, setProduct] = useState("");
  return (
    <details className="record">
      <summary>Record a verified supplier offer</summary>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget),
            nullable = (k: string) =>
              f.get(k) === "" ? null : Number(f.get(k));
          await mutate(
            "/offers",
            "POST",
            {
              productId,
              supplierName: f.get("supplier"),
              source: f.get("offerSource"),
              sku: f.get("supplierSku"),
              region: f.get("region"),
              variantId: f.get("variant") || null,
              moq: Number(f.get("moq")),
              unitCost: Number(f.get("unitCost")),
              shippingCost: nullable("shippingCost"),
              deliveryDays: nullable("deliveryDays"),
              rating: nullable("rating"),
              stockStatus: f.get("stock"),
              reference: f.get("reference"),
              lastChecked: new Date(String(f.get("checked"))).toISOString(),
            },
            "Supplier offer saved with source reference. Review and save product economics separately.",
          );
        }}
      >
        <div className="formGrid">
          <label className="field">
            <span>Offer product</span>
            <select
              required
              value={productId}
              onChange={(e) => setProduct(e.target.value)}
            >
              <option value="">Select product</option>
              {d.products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Variant</span>
            <select name="variant">
              <option value="">Unspecified</option>
              {d.variants
                .filter((v) => v.productId === productId)
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.sku}
                  </option>
                ))}
            </select>
          </label>
          {[
            ["supplier", "Supplier name"],
            ["offerSource", "Offer source (operator entered)"],
            ["supplierSku", "Supplier SKU"],
            ["region", "Country / region"],
            ["reference", "Offer source URL"],
          ].map(([name, label]) => (
            <label className="field" key={name}>
              <span>{label}</span>
              <input
                name={name}
                required
                type={name === "reference" ? "url" : "text"}
              />
            </label>
          ))}
          {[
            ["moq", "MOQ", true],
            ["unitCost", "Unit cost (INR)", true],
            ["shippingCost", "Shipping cost (INR)", false],
            ["deliveryDays", "Delivery days", false],
            ["rating", "Supplier confidence (0–100)", false],
          ].map(([name, label, required]) => (
            <label className="field" key={String(name)}>
              <span>{label}</span>
              <input
                type="number"
                name={String(name)}
                required={Boolean(required)}
                min={name === "moq" || name === "deliveryDays" ? 1 : 0}
                max={name === "rating" ? 100 : undefined}
                step={
                  name === "unitCost" || name === "shippingCost" ? "0.01" : "1"
                }
              />
            </label>
          ))}
          <label className="field">
            <span>Stock status</span>
            <select name="stock">
              <option>UNKNOWN</option>
              <option>IN_STOCK</option>
              <option>OUT_OF_STOCK</option>
            </select>
          </label>
          <label className="field">
            <span>Last checked</span>
            <input
              name="checked"
              type="date"
              required
              max={new Date().toISOString().slice(0, 10)}
            />
          </label>
        </div>
        <p className="help">
          Leave unknown shipping, delivery and confidence blank. Offers do not
          automatically become economic assumptions.
        </p>
        <button>Save supplier offer</button>
      </form>
    </details>
  );
}
export function VariantCreate({
  productId,
  mutate,
}: {
  productId: string;
  mutate: Mutate;
}) {
  return (
    <details>
      <summary>Add product variant</summary>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          await mutate(
            "/variants",
            "POST",
            {
              productId,
              sku: f.get("sku"),
              attributes: { description: String(f.get("attributes")) },
            },
            "Variant saved.",
          );
        }}
      >
        <label className="field">
          <span>SKU</span>
          <input name="sku" required />
        </label>
        <label className="field">
          <span>Variant attributes</span>
          <input
            name="attributes"
            placeholder="Color, size, material"
            required
          />
        </label>
        <button>Save variant</button>
      </form>
    </details>
  );
}
