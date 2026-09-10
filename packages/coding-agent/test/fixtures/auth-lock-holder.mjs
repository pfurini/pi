import lockfile from "proper-lockfile";

const release = lockfile.lockSync(process.argv[2], { realpath: false, stale: 30_000 });
process.send("acquired");
process.once("message", () => {
	setTimeout(() => {
		release();
		process.disconnect();
	}, 300);
});
