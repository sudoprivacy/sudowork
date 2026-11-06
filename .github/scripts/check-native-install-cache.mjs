import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const cacheAction = "./.github/actions/cache-sharp-libvips";
const installerAction = "./.github/actions/install-bun-dependencies";

/** Every workspace install that runs dependency hooks needs the checked cache first. */
export function unpreparedNativeInstalls(
  workflow,
  preparers = [cacheAction, installerAction],
) {
  const issues = [];
  for (const [job, configuration] of Object.entries(workflow.jobs ?? {})) {
    let prepared = false;
    for (const step of configuration.steps ?? []) {
      if (preparers.includes(step.uses) && !step.if) prepared = true;
      const commands = [step.run, step.with?.command].filter(
        (value) => typeof value === "string",
      );
      const hasNativeInstall = commands.some((command) =>
        command.split(/\r?\n|&&|\|\||;/).some((line) => {
          if (/^\s*(?:#|echo\b|printf\b)/.test(line)) return false;
          return (
            /\bbun\s+(?:install|i)(?:\s|$)/.test(line) &&
            !/(?:^|\s)(?:--ignore-scripts|--global|-g)(?:\s|$)/.test(line)
          );
        }),
      );
      if (hasNativeInstall && !prepared)
        issues.push({ job, step: step.name ?? "unnamed install" });
    }
  }
  return issues;
}

if (import.meta.main) {
  if (typeof Bun === "undefined" || !Bun.YAML)
    throw new Error("Run this check with the repository's pinned Bun runtime.");
  const directory = fileURLToPath(new URL("../workflows/", import.meta.url));
  const failures = [];
  const installer = Bun.YAML.parse(
    readFileSync(
      fileURLToPath(
        new URL(
          "../actions/install-bun-dependencies/action.yml",
          import.meta.url,
        ),
      ),
      "utf8",
    ),
  );
  if (installer.runs?.using !== "composite")
    throw new Error(
      "The shared native installer must declare its preparation steps.",
    );
  for (const issue of unpreparedNativeInstalls(
    { jobs: { sharedInstaller: installer.runs } },
    [cacheAction],
  )) {
    failures.push(`install-bun-dependencies/action.yml: ${issue.step}`);
  }
  for (const name of readdirSync(directory).filter((name) =>
    /\.ya?ml$/.test(name),
  )) {
    const workflow = Bun.YAML.parse(
      readFileSync(join(directory, name), "utf8"),
    );
    for (const issue of unpreparedNativeInstalls(workflow)) {
      failures.push(`${name}: ${issue.job}: ${issue.step}`);
    }
  }
  if (failures.length) {
    console.error(
      `Use the shared installer or prepare ${cacheAction} unconditionally before dependency install hooks:\n${failures.join("\n")}`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      "All declared native workspace installs use the verified cache.",
    );
  }
}
