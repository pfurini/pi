/**
 * Skills Configuration
 *
 * Skills provide specialized instructions loaded into the system prompt.
 * Discover, filter, merge, or replace them.
 */

import {
	createAgentSession,
	createSyntheticSourceInfo,
	DefaultResourceLoader,
	extractSkillListingBlock,
	getAgentDir,
	SessionManager,
	type Skill,
} from "@earendil-works/pi-coding-agent";

// Or define custom skills inline. `frontmatter` is optional and folds into the listing
// (when_to_use, argument-hint, etc.) and into the skill-set seam extensions read.
const customSkill: Skill = {
	name: "my-skill",
	description: "Custom project instructions",
	filePath: "/virtual/SKILL.md",
	baseDir: "/virtual",
	sourceInfo: createSyntheticSourceInfo("/virtual/SKILL.md", { source: "sdk" }),
	disableModelInvocation: false,
	frontmatter: { when_to_use: "Use when scaffolding project-specific instructions." },
};

const loader = new DefaultResourceLoader({
	cwd: process.cwd(),
	agentDir: getAgentDir(),
	skillsOverride: (current) => {
		const filteredSkills = current.skills.filter((s) => s.name.includes("browser") || s.name.includes("search"));
		return {
			skills: [...filteredSkills, customSkill],
			diagnostics: current.diagnostics,
		};
	},
});
await loader.reload();

// Discover all skills from cwd/.pi/skills, ~/.pi/agent/skills, etc.
const { skills: allSkills, diagnostics } = loader.getSkills();
console.log(
	"Discovered skills:",
	allSkills.map((s) => s.name),
);
if (diagnostics.length > 0) {
	console.log("Warnings:", diagnostics);
}

const { session } = await createAgentSession({
	resourceLoader: loader,
	sessionManager: SessionManager.inMemory(),
});
console.log("Session created with filtered skills");

// Round-trip the emitted listing block back out of the system prompt.
const listingBlock = extractSkillListingBlock(session.systemPrompt);
if (listingBlock) {
	console.log("Skill listing block:", listingBlock);
}

session.dispose();
