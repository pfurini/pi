import { expect, test } from "vitest";
import { rankSymbolMatches } from "../../../src/core/fork-builtins/tokensave/tools.ts";

test("exact case-sensitive match is ranked first", () => {
	const ranked = rankSymbolMatches("WellModel", [
		{ name: "wellmodel_migration_0001", file: "db/migrations/0001.sql" },
		{ name: "wellmodelHelper", file: "src/helpers.ts" },
		{ name: "WellModel", file: "core/models/well_model.py" },
	]);

	expect(ranked[0].name).toBe("WellModel");
	expect(ranked[0].rank).toBe("exact-case-sensitive");
});

test("exact case-sensitive beats exact case-insensitive", () => {
	const ranked = rankSymbolMatches("WellModel", [{ name: "wellmodel" }, { name: "WellModel" }]);

	expect(ranked.map((m) => m.name)).toStrictEqual(["WellModel", "wellmodel"]);
	expect(ranked[0].rank).toBe("exact-case-sensitive");
	expect(ranked[1].rank).toBe("exact-case-insensitive");
});

test("exact symbol match beats prefix and partial matches", () => {
	const ranked = rankSymbolMatches("WellModel", [
		{ name: "WellModelSerializer" },
		{ name: "AbstractWellModelMixin" },
		{ name: "WellModel" },
	]);

	expect(ranked[0].name).toBe("WellModel");
	expect(ranked[0].rank).toBe("exact-case-sensitive");
	expect(ranked[1].rank).toBe("prefix");
	expect(ranked[2].rank).toBe("partial");
});

test("qualified-name exact match is recognized when bare name differs", () => {
	const ranked = rankSymbolMatches("WellModel", [{ name: "SomethingElse", qualified_name: "pkg.mod.WellModel" }]);
	expect(ranked[0].rank).toBe("qualified-exact");
});

test("symbol-kind priority: a definition kind outranks a same-named reference kind", () => {
	const cases: Array<[string, string]> = [
		["data_class", "field"],
		["type_alias", "field"],
		["class", "field"],
		["function", "property"],
	];
	for (const [definitionKind, referenceKind] of cases) {
		const ranked = rankSymbolMatches("Thing", [
			{ name: "Thing", kind: referenceKind, file: "src/reference.ts" },
			{ name: "Thing", kind: definitionKind, file: "src/definition.ts" },
		]);
		expect(ranked[0].kind, `${definitionKind} should outrank ${referenceKind}`).toBe(definitionKind);
	}
});

test("WellModel resolves to the real class definition even with many similarly named references", () => {
	const matches = [
		{ name: "wellmodel_0001_initial", kind: "migration", file: "db/migrations/0001_initial.py" },
		{ name: "wellmodel_0002_add_index", kind: "migration", file: "db/migrations/0002_add_index.py" },
		{ name: "WellModelSerializer", kind: "class", file: "api/serializers.py" },
		{ name: "WellModelAdmin", kind: "class", file: "admin.py" },
		{
			name: "WellModel",
			kind: "class",
			file: "core/models/well_model.py",
			signature: "class WellModel(models.Model)",
		},
	];

	const ranked = rankSymbolMatches("WellModel", matches);
	expect(ranked[0].name).toBe("WellModel");
	expect(ranked[0].file).toBe("core/models/well_model.py");
	expect(ranked[0].rank).toBe("exact-case-sensitive");
});
