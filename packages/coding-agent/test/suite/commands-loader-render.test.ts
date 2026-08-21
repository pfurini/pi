/**
 * A.7 command loading, A.7.1 include inlining, and the A.7 render pipeline.
 * Covers native command discovery + invalid-name diagnostics, prompt-template
 * adaptation, every A.7.1 marker path, and the render stage set (A.3.2
 * arguments, `${PI_*}` variables, unconditional default-bash shell injection).
 */

import { chmodSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inlineCommandIncludes } from "../../src/core/commands/include.ts";
import type { LoadedCommand } from "../../src/core/commands/loader.ts";
import { adaptPromptTemplate, loadCommandsFromDir } from "../../src/core/commands/loader.ts";
import { type RenderCommandContext, renderCommand } from "../../src/core/commands/render.ts";
import type { SourceInfo } from "../../src/core/source-info.ts";
import type { BashOperations } from "../../src/core/tools/bash.ts";

const tempDirs: string[] = [];

function makeTempDir(): string {
	const dir = join(tmpdir(), `commands-test-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

const sourceInfo = (path: string): SourceInfo => ({ path, source: "local", scope: "user", origin: "top-level" });

function renderContext(overrides: Partial<RenderCommandContext> = {}): RenderCommandContext {
	return {
		cwd: "/tmp",
		sessionId: "sess-1",
		thinkingLevel: "medium",
		skillInterop: true,
		activeToolNames: ["bash"],
		shellSettings: { disabled: false, timeoutMs: 30000, outputLimitBytes: 16384 },
		...overrides,
	};
}

function commandFrom(dir: string, name: string, frontmatter: Record<string, unknown>, body: string): LoadedCommand {
	const filePath = join(dir, `${name}.md`);
	return {
		kind: "command",
		name,
		frontmatter,
		body,
		filePath,
		baseDir: dir,
		sourceInfo: sourceInfo(filePath),
		commandNameValid: true,
		userInvocable: true,
		disableModelInvocation: false,
	};
}

describe("command loader", () => {
	it("loads native command files with A.7 frontmatter", () => {
		const dir = makeTempDir();
		writeFileSync(
			join(dir, "deploy.md"),
			"---\nname: deploy\ndescription: Deploy the app\nargument-hint: <env>\n---\nDeploy to $1\n",
		);
		const result = loadCommandsFromDir(dir, sourceInfo);
		expect(result.commands).toHaveLength(1);
		const command = result.commands[0];
		expect(command.name).toBe("deploy");
		expect(command.description).toBe("Deploy the app");
		expect(command.argumentHint).toBe("<env>");
		expect(command.commandNameValid).toBe(true);
		expect(result.diagnostics).toHaveLength(0);
	});

	it("emits exactly one diagnostic for an invalid bare name but still loads the command", () => {
		const dir = makeTempDir();
		writeFileSync(join(dir, "x.md"), "---\nname: 'skill:reserved'\ndescription: d\n---\nbody\n");
		const result = loadCommandsFromDir(dir, sourceInfo);
		expect(result.commands).toHaveLength(1);
		expect(result.commands[0].commandNameValid).toBe(false);
		expect(result.diagnostics).toHaveLength(1);
		expect(result.diagnostics[0].message).toContain("not eligible");
	});

	it("derives name from filename when frontmatter omits it", () => {
		const dir = makeTempDir();
		writeFileSync(join(dir, "release.md"), "Release notes body\n");
		const result = loadCommandsFromDir(dir, sourceInfo);
		expect(result.commands[0].name).toBe("release");
		expect(result.commands[0].description).toBe("Release notes body");
	});

	it("treats an absent commands directory as empty without a diagnostic", () => {
		const result = loadCommandsFromDir(join(makeTempDir(), "does-not-exist"), sourceInfo);
		expect(result.commands).toEqual([]);
		expect(result.diagnostics).toEqual([]);
	});

	it("emits a warning diagnostic when the commands directory cannot be read", () => {
		const dir = makeTempDir();
		writeFileSync(join(dir, "deploy.md"), "body\n");
		chmodSync(dir, 0o000);
		let result: ReturnType<typeof loadCommandsFromDir> | undefined;
		try {
			result = loadCommandsFromDir(dir, sourceInfo);
		} finally {
			chmodSync(dir, 0o755);
		}
		// Root bypasses permission bits; accept either the diagnostic or a normal load.
		const warned = result.diagnostics.some((d) => d.message.includes("could not read commands directory"));
		const loaded = result.commands.length === 1;
		expect(warned || loaded).toBe(true);
	});
	it("adapts a prompt template into a grandfathered command", () => {
		const command = adaptPromptTemplate({
			name: "changelog",
			description: "Update changelog",
			content: "Body $ARGUMENTS",
			sourceInfo: sourceInfo("/prompts/changelog.md"),
			filePath: "/prompts/changelog.md",
		});
		expect(command.kind).toBe("prompt");
		expect(command.name).toBe("changelog");
		expect(command.userInvocable).toBe(true);
		expect(command.disableModelInvocation).toBe(false);
	});
});

describe("A.7.1 include inlining", () => {
	it("inlines a relative include and recurses", () => {
		const dir = makeTempDir();
		writeFileSync(join(dir, "child.md"), "CHILD @grandchild.md");
		writeFileSync(join(dir, "grandchild.md"), "GRAND");
		const result = inlineCommandIncludes("root @child.md end", join(dir, "root.md"));
		expect(result.text).toBe("root CHILD GRAND end");
	});

	it("`\\@path` escapes to a literal `@path`", () => {
		const dir = makeTempDir();
		const result = inlineCommandIncludes("see \\@notes.md", join(dir, "root.md"));
		expect(result.text).toBe("see @notes.md");
	});

	it("does not inline inside fenced code blocks", () => {
		const dir = makeTempDir();
		writeFileSync(join(dir, "x.md"), "SHOULD-NOT-INLINE");
		const result = inlineCommandIncludes("```\n@x.md\n```", join(dir, "root.md"));
		expect(result.text).toContain("@x.md");
		expect(result.text).not.toContain("SHOULD-NOT-INLINE");
	});

	it("marks a missing include", () => {
		const dir = makeTempDir();
		const result = inlineCommandIncludes("@nope.md", join(dir, "root.md"));
		expect(result.text).toBe("[include not found: nope.md]");
		expect(result.diagnostics).toHaveLength(1);
	});

	it("marks a directory include", () => {
		const dir = makeTempDir();
		mkdirSync(join(dir, "subdir"));
		const result = inlineCommandIncludes("@subdir", join(dir, "root.md"));
		expect(result.text).toBe("[include is a directory: subdir]");
	});

	it("marks a non-UTF-8 include", () => {
		const dir = makeTempDir();
		writeFileSync(join(dir, "bin.md"), Buffer.from([0xff, 0xfe, 0x00, 0x80]));
		const result = inlineCommandIncludes("@bin.md", join(dir, "root.md"));
		expect(result.text).toBe("[include not text: bin.md]");
	});

	it("marks an over-size include", () => {
		const dir = makeTempDir();
		writeFileSync(join(dir, "big.md"), "a".repeat(64 * 1024 + 1));
		const result = inlineCommandIncludes("@big.md", join(dir, "root.md"));
		expect(result.text).toBe("[include too large: big.md]");
		expect(result.diagnostics).toHaveLength(1);
		expect(result.diagnostics[0].message).toContain('include too large: "big.md"');
	});

	it("marks the reference that crosses the 256 KiB total cap", () => {
		const dir = makeTempDir();
		// Each file fits the per-file 64 KiB cap; five of them cross the total.
		for (const name of ["a", "b", "c", "d", "e"]) {
			writeFileSync(join(dir, `${name}.md`), "x".repeat(60 * 1024));
		}
		const result = inlineCommandIncludes("@a.md @b.md @c.md @d.md @e.md", join(dir, "root.md"));
		expect(result.text).toContain("[include too large: e.md]");
		expect(result.text).not.toContain("[include too large: d.md]");
		expect(result.diagnostics).toHaveLength(1);
		expect(result.diagnostics[0].message).toContain('include too large: "e.md"');
	});

	it("does not inline an include inside an inline code span", () => {
		const dir = makeTempDir();
		writeFileSync(join(dir, "secret.md"), "SECRET-CONTENTS");
		const result = inlineCommandIncludes("`` `@secret.md` ``", join(dir, "root.md"));
		expect(result.text).toBe("`` `@secret.md` ``");
		expect(result.text).not.toContain("SECRET-CONTENTS");
		expect(result.diagnostics).toHaveLength(0);
	});
	it("detects a cycle by canonical path", () => {
		const dir = makeTempDir();
		writeFileSync(join(dir, "a.md"), "A @b.md");
		writeFileSync(join(dir, "b.md"), "B @a.md");
		const result = inlineCommandIncludes("@a.md", join(dir, "root.md"));
		expect(result.text).toContain("[include cycle: a.md]");
	});

	it("stops recursion beyond depth 10", () => {
		const dir = makeTempDir();
		for (let i = 0; i < 12; i++) {
			writeFileSync(join(dir, `d${i}.md`), `L${i} @d${i + 1}.md`);
		}
		const result = inlineCommandIncludes("@d0.md", join(dir, "root.md"));
		expect(result.text).toContain("[include depth exceeded:");
	});

	it("marks a permission failure without throwing", () => {
		const dir = makeTempDir();
		const target = join(dir, "secret.md");
		writeFileSync(target, "secret");
		chmodSync(target, 0o000);
		const result = inlineCommandIncludes("@secret.md", join(dir, "root.md"));
		chmodSync(target, 0o644);
		// Root user bypasses permission bits; accept either the read-failed marker or the inlined content.
		expect(result.text === "[include read failed: secret.md]" || result.text === "secret").toBe(true);
	});

	it("skips a broken symlink with a marker", () => {
		const dir = makeTempDir();
		try {
			symlinkSync(join(dir, "missing-target.md"), join(dir, "link.md"));
		} catch {
			return; // symlink unsupported on this platform
		}
		const result = inlineCommandIncludes("@link.md", join(dir, "root.md"));
		expect(result.text).toBe("[include not found: link.md]");
	});
});

describe("A.7 render pipeline", () => {
	it("runs include → arguments → variables in order", async () => {
		const dir = makeTempDir();
		writeFileSync(join(dir, "inc.md"), "INCLUDED");
		// biome-ignore lint/suspicious/noTemplateCurlyInString: ${PI_SESSION_ID} is an A.8 render placeholder, not a JS template
		const command = commandFrom(dir, "c", {}, "@inc.md then $1 in ${PI_SESSION_ID}");
		const rendered = await renderCommand(command, "alpha", renderContext());
		expect(rendered.text).toBe("INCLUDED then alpha in sess-1");
	});

	it("appends raw ARGUMENTS when no placeholder consumed input (A.3.2 rule 7)", async () => {
		const dir = makeTempDir();
		const command = commandFrom(dir, "c", {}, "no placeholders here");
		const rendered = await renderCommand(command, "extra args", renderContext());
		expect(rendered.text).toBe("no placeholders here\n\nARGUMENTS: extra args");
	});

	it("runs default-bash shell injection when `shell` is omitted", async () => {
		const dir = makeTempDir();
		const calls: string[] = [];
		const operations: BashOperations = {
			exec: async (command, _cwd, { onData }) => {
				calls.push(command);
				onData(Buffer.from("RESULT"));
				return { exitCode: 0 };
			},
		};
		const command = commandFrom(dir, "c", {}, "output: !`echo hi`");
		const rendered = await renderCommand(command, "", renderContext({ bashOperations: operations }));
		expect(calls).toEqual(["echo hi"]);
		expect(rendered.text).toBe("output: RESULT");
	});

	it("disables shell injection when bash is not an active tool", async () => {
		const dir = makeTempDir();
		const operations: BashOperations = {
			exec: async () => {
				throw new Error("should not run");
			},
		};
		const command = commandFrom(dir, "c", {}, "x: !`echo hi`");
		const rendered = await renderCommand(
			command,
			"",
			renderContext({ activeToolNames: [], bashOperations: operations }),
		);
		expect(rendered.text).toContain("[shell command execution disabled by tool policy]");
	});
});
