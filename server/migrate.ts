import type { SqliteRepository } from "./database";
export function migrateIdentityAndScores(repo: SqliteRepository) {
  repo.transaction(() => {
    if (
      repo.db
        .prepare("SELECT version FROM schema_migrations WHERE version=2")
        .get()
    )
      return;
    for (const product of repo.list("products")) {
      const observations = repo
        .list("observations")
        .filter(
          (o) =>
            o.productName === product.name && o.category === product.category,
        );
      const dates = observations.map((o) => o.observedAt).sort();
      repo.put("products", {
        ...product,
        canonicalName: product.canonicalName ?? product.name,
        aliases: product.aliases ?? [product.name],
        sourceReferences: product.sourceReferences ?? [
          ...new Set(
            observations.flatMap((o) => (o.reference ? [o.reference] : [])),
          ),
        ],
        firstSeen: product.firstSeen ?? dates[0] ?? product.createdAt,
        lastSeen: product.lastSeen ?? dates.at(-1) ?? product.updatedAt,
      });
    }
    for (const opportunity of repo.list("opportunities")) {
      repo.put("opportunities", {
        ...opportunity,
        scoreVersion: opportunity.scoring.version,
        scoredAt: opportunity.scoredAt ?? opportunity.updatedAt,
      });
      repo.put("scoreHistory", {
        id: `migration-baseline-${opportunity.id}`,
        workspaceId: opportunity.workspaceId,
        mode: opportunity.mode,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        productId: opportunity.productId,
        opportunityId: opportunity.id,
        reason:
          "MIGRATION_BASELINE (original score retained, not recalculated)",
        scoreVersion: opportunity.scoring.version,
        inputs: opportunity.inputs,
        scoring: opportunity.scoring,
        signalIds: opportunity.signalIds,
        evidence: { originalUpdatedAt: opportunity.updatedAt },
      });
    }
    repo.db
      .prepare("INSERT INTO schema_migrations VALUES(2,?)")
      .run(new Date().toISOString());
    repo.db.exec(
      `CREATE TRIGGER IF NOT EXISTS immutable_evidence_update BEFORE UPDATE ON records WHEN OLD.kind IN ('scoreHistory','audit') BEGIN SELECT RAISE(ABORT,'Historical evidence is append-only'); END; CREATE TRIGGER IF NOT EXISTS immutable_evidence_delete BEFORE DELETE ON records WHEN OLD.kind IN ('scoreHistory','audit') BEGIN SELECT RAISE(ABORT,'Historical evidence is append-only'); END;`,
    );
  });
}
