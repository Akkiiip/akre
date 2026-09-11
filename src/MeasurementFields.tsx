import { factors } from "../shared/domain";
import { factorLabel } from "../shared/scoring";
export function measurementsFromForm(form: FormData) {
  return factors.flatMap((factor) => {
    const raw = form.get(`signal-${factor}`);
    return raw === null || raw === ""
      ? []
      : [
          {
            factor,
            value: Number(raw),
            min: Number(form.get(`min-${factor}`)),
            max: Number(form.get(`max-${factor}`)),
            unit: String(form.get(`unit-${factor}`)),
          },
        ];
  });
}
export function MeasurementFields() {
  return (
    <details>
      <summary>Optional measured factors</summary>
      <p className="help">
        Enter only measurements supported by this source. Leave missing factors
        blank. Bounds and units are explicit normalization assumptions saved
        with the evidence. Pageviews do not establish purchasing demand.
      </p>
      {factors.map((factor) => (
        <div className="formGrid" key={factor}>
          <label className="field">
            <span>{factorLabel(factor)} raw value</span>
            <input name={`signal-${factor}`} type="number" step="any" />
          </label>
          <label className="field">
            <span>{factorLabel(factor)} unit</span>
            <input name={`unit-${factor}`} defaultValue="index" />
          </label>
          <label className="field">
            <span>{factorLabel(factor)} lower bound</span>
            <input
              name={`min-${factor}`}
              type="number"
              step="any"
              defaultValue={0}
            />
          </label>
          <label className="field">
            <span>{factorLabel(factor)} upper bound</span>
            <input
              name={`max-${factor}`}
              type="number"
              step="any"
              defaultValue={100}
            />
          </label>
        </div>
      ))}
    </details>
  );
}
