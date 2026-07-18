/**
 * Статический аудит production HTTPS / Caddy reverse-proxy foundation.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const SECRET_PATTERNS = [
  /BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/,
  /AUTH_SECRET=generate/,
  /POSTGRES_PASSWORD=change-me/,
  /SMTP_PASSWORD=\S+/,
] as const;

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function stripBashComments(source: string): string {
  const lines = source.split("\n");
  const out: string[] = [];
  let inHeredoc = false;
  let heredocMarker = "";
  for (const line of lines) {
    if (inHeredoc) {
      out.push(line);
      if (line.trim() === heredocMarker) inHeredoc = false;
      continue;
    }
    const heredocMatch = line.match(/<<-?\s*['"]?(\w+)['"]?/);
    if (heredocMatch) {
      inHeredoc = true;
      heredocMarker = heredocMatch[1] ?? "";
      out.push(line);
      continue;
    }
    if (/^\s*#/.test(line)) continue;
    out.push(line.replace(/(^|[^\\])#.*$/, "$1"));
  }
  return out.join("\n");
}

function resolveBashExecutable(): string {
  for (const candidate of ["C:\\Program Files\\Git\\bin\\bash.exe", "bash"]) {
    const probe = spawnSync(candidate, ["-c", "echo ok"], { encoding: "utf8" });
    if (probe.status === 0) return candidate;
  }
  return "bash";
}

function assertCaddyfile(): void {
  const caddy = read("deploy/caddy/Caddyfile.production");

  assert.match(caddy, /tvoio-vremya\.ru/);
  assert.match(caddy, /www\.tvoio-vremya\.ru/);
  assert.match(caddy, /redir https:\/\/tvoio-vremya\.ru\{uri\} permanent/);
  assert.match(caddy, /reverse_proxy 127\.0\.0\.1:3100/);
  assert.match(caddy, /encode zstd gzip/);

  assert.doesNotMatch(caddy, /127\.0\.0\.1:3000/);
  assert.doesNotMatch(caddy, /on_demand/);
  assert.doesNotMatch(caddy, /tvoe-vremya-staging/);
  assert.doesNotMatch(caddy, /\.env\.staging/);
  assert.doesNotMatch(caddy, /Strict-Transport-Security/);
  assert.doesNotMatch(caddy, /preload/);
  assert.doesNotMatch(caddy, /includeSubDomains/);
  assert.doesNotMatch(caddy, /BEGIN .*PRIVATE KEY/);
  assert.doesNotMatch(caddy, /tls\s+[^\n]*\.pem/);
  assert.doesNotMatch(caddy, /5432/);

  for (const pattern of SECRET_PATTERNS) {
    assert.doesNotMatch(caddy, pattern);
  }
}

function assertComposeAndEnv(): void {
  const compose = read("docker-compose.production.yml");
  const postgresBlock = compose.match(/postgres:[\s\S]*?(?=\n  app:)/)?.[0] ?? "";
  assert.match(compose, /127\.0\.0\.1:\$\{APP_PORT:-3100\}:3000/);
  assert.doesNotMatch(postgresBlock, /ports:/);
  assert.doesNotMatch(compose, /127\.0\.0\.1:\$\{APP_PORT:-3000\}/);

  const example = read(".env.production.example");
  assert.match(example, /AUTH_URL=https:\/\/tvoio-vremya\.ru/);
  assert.match(example, /TRUST_PROXY_HEADERS=true/);
  assert.match(example, /APP_PORT=3100/);
}

function assertHelper(): void {
  const source = read("scripts/ops/install-production-reverse-proxy.sh");
  const executable = stripBashComments(source);

  assert.match(executable, /ops_assert_production_checkout/);
  assert.match(executable, /\/opt\/online-zapis-tv-production/);
  assert.match(executable, /INSTALL PRODUCTION REVERSE PROXY/);
  assert.match(executable, /ops_acquire_production_ops_lock/);
  assert.match(executable, /caddy validate/);
  assert.match(executable, /systemctl reload caddy/);
  assert.match(executable, /restore_previous_caddyfile/);
  assert.match(executable, /assert_dns_points_to_production/);
  assert.match(executable, /PRODUCTION_PUBLIC_IPV4="72\.56\.0\.12"/);
  assert.match(executable, /AUTH_URL must be exactly/);
  assert.match(executable, /TRUST_PROXY_HEADERS must be true/);
  assert.match(executable, /Caddyfile\.production/);
  assert.match(executable, /\/var\/backups\/online-zapis-tv-production-caddy/);

  assert.doesNotMatch(executable, /^\s*(sudo\s+)?apt(-get)?\s+install\b/m);
  assert.doesNotMatch(executable, /ufw\b|firewall-cmd/);
  assert.doesNotMatch(executable, /systemctl\s+stop\b/);
  assert.doesNotMatch(executable, /systemctl\s+restart\s+caddy/);
  assert.doesNotMatch(executable, /127\.0\.0\.1:3000/);
  assert.doesNotMatch(executable, /tvoe-vremya-staging/);
  assert.doesNotMatch(executable, /require[^\n]*AAAA|AAAA is required|must[^\n]*AAAA|AAAA[^\n]*must/i);
  assert.doesNotMatch(executable, /nsupdate|dnscontrol|cloudflare|route53/i);
  assert.match(executable, /AAAA not required/);
  assert.match(executable, /does not install packages/i);

  assert.match(executable, /ss_extract_listener_process_names/);
  assert.match(executable, /port_owned_by_active_caddy_service/);
  assert.match(executable, /sudo -n ss -ltnp/);
  assert.match(executable, /systemctl show -p MainPID --value caddy/);
  assert.match(executable, /marker='users:\(\(\"'/);
  assert.match(executable, /Ports 80\/443: free or owned by caddy/);
  assert.match(
    executable,
    /port 80 is used by '\$\{proc80\}' \(not caddy\)\. Refusing to change anything automatically/,
  );
  assert.match(
    executable,
    /port 443 is used by '\$\{proc443\}' \(not caddy\)\. Refusing to change anything automatically/,
  );
  assert.doesNotMatch(executable, /\$line" =~ users:/);
  assert.doesNotMatch(executable, /sed -n 's\/\.\*users:/);

  const listenerBody = (() => {
    const start = source.indexOf("listener_process_for_port()");
    const end = source.indexOf("assert_http_ports_safe()");
    assert.ok(start >= 0 && end > start, "listener_process_for_port must precede assert_http_ports_safe");
    return stripBashComments(source.slice(start, end));
  })();
  assert.match(listenerBody, /printf 'caddy'/);
  assert.match(listenerBody, /printf 'unknown'/);
  assert.match(listenerBody, /port_owned_by_active_caddy_service/);
  assert.match(listenerBody, /foreign=/);

  const portsBody = (() => {
    const start = source.indexOf("assert_http_ports_safe()");
    const end = source.indexOf("resolve_ipv4_addresses()");
    assert.ok(start >= 0 && end > start, "assert_http_ports_safe must exist");
    return stripBashComments(source.slice(start, end));
  })();
  assert.match(portsBody, /"\$proc80" != "caddy"/);
  assert.match(portsBody, /"\$proc443" != "caddy"/);
  assert.doesNotMatch(portsBody, /systemctl\s+stop/);
  assert.doesNotMatch(portsBody, /fuser\s+-k|kill\s+-9/);

  const dryIdx = executable.indexOf('ops_info "Dry-run complete');
  const lockIdx = executable.indexOf("ops_acquire_production_ops_lock");
  assert.ok(dryIdx >= 0 && lockIdx > dryIdx, "dry-run must exit before lock");

  const applyInstallIdx = executable.indexOf("apply_install()");
  assert.ok(applyInstallIdx >= 0, "apply_install must exist");
  const mainIdx = executable.indexOf("\nmain()");
  const applyBody = executable.slice(
    applyInstallIdx,
    mainIdx > applyInstallIdx ? mainIdx : executable.length,
  );
  const validateSrcIdx = applyBody.indexOf("validate_caddyfile \"$src\"");
  const reloadIdx = applyBody.indexOf("systemctl reload caddy");
  assert.ok(validateSrcIdx >= 0 && reloadIdx > validateSrcIdx, "validate before reload");
  assert.match(applyBody, /assert_dns_points_to_production/);

  const dryMatch = executable.match(
    /if \[\[ "\$OPS_DRY_RUN" -eq 1 \]\]; then([\s\S]*?)exit 0/,
  );
  assert.ok(dryMatch, "dry-run early-exit block required");
  assert.doesNotMatch(dryMatch[1], /assert_dns_points_to_production/);
  assert.doesNotMatch(dryMatch[1], /ops_acquire_production_ops_lock|systemctl|mkdir|install -m/);
}

function assertExecutableBit(): void {
  const bash = resolveBashExecutable();
  const mode = spawnSync(
    bash,
    ["-c", "stat -c '%a' scripts/ops/install-production-reverse-proxy.sh 2>/dev/null || stat -f '%Lp' scripts/ops/install-production-reverse-proxy.sh"],
    { cwd: ROOT, encoding: "utf8" },
  );
  // On Windows working tree mode may not reflect git 100755; prefer git ls-files.
  const gitMode = spawnSync("git", ["ls-files", "-s", "scripts/ops/install-production-reverse-proxy.sh"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(gitMode.status, 0, gitMode.stderr);
  assert.match(gitMode.stdout, /^100755\s/);
  void mode;
}

function assertDocumentation(): void {
  const doc = read("docs/operations/production-https.md");
  assert.match(doc, /tvoio-vremya\.ru/);
  assert.match(doc, /72\.56\.0\.12/);
  assert.match(doc, /INSTALL PRODUCTION REVERSE PROXY/);
  assert.match(doc, /--dry-run/);
  assert.match(doc, /--install/);
  assert.match(doc, /MX/);
  assert.match(doc, /AAAA/);
  assert.match(doc, /staging/i);
  assert.match(doc, /systemctl reload caddy/);

  const composeDoc = read("docs/operations/production-compose.md");
  assert.match(composeDoc, /production-https\.md/);
  const deployDoc = read("docs/operations/production-deploy.md");
  assert.match(deployDoc, /production-https\.md/);
}

function assertNextHeadersNotDuplicatedAggressively(): void {
  const nextConfig = read("next.config.ts");
  assert.match(nextConfig, /Content-Security-Policy-Report-Only/);
  assert.doesNotMatch(nextConfig, /Strict-Transport-Security/);

  const caddy = read("deploy/caddy/Caddyfile.production");
  assert.doesNotMatch(caddy, /Content-Security-Policy/);
  assert.doesNotMatch(caddy, /X-Frame-Options/);
}

function assertShellSyntaxAndHelp(): void {
  const bash = resolveBashExecutable();
  const syntax = spawnSync(bash, ["-n", "scripts/ops/install-production-reverse-proxy.sh"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(syntax.status, 0, `bash -n failed:\n${syntax.stderr}`);

  const help = spawnSync(bash, ["scripts/ops/install-production-reverse-proxy.sh", "--help"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /INSTALL PRODUCTION REVERSE PROXY/);
  assert.match(help.stdout, /--dry-run/);
}

function run(): void {
  assertCaddyfile();
  assertComposeAndEnv();
  assertHelper();
  assertExecutableBit();
  assertDocumentation();
  assertNextHeadersNotDuplicatedAggressively();
  assertShellSyntaxAndHelp();
  console.log("security-production-https-check: OK");
}

run();
