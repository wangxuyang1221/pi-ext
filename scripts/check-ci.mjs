try {
  const results = JSON.parse(process.env.CI_JOB_RESULTS ?? "null");
  const required = ["test", "unix-host", "python-and-skills"];
  if (!results || required.some(name => results[name]?.result !== "success") ||
    Object.values(results).some(job => job?.result !== "success")) {
    throw new Error("Every required CI job must succeed; failed, cancelled, skipped, or missing jobs block this check.");
  }
  console.log("All required CI jobs passed.");
} catch {
  console.error("CI gate failed: every required job must report success.");
  process.exitCode = 1;
}
