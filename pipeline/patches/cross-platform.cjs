/**
 * cross-platform.cjs — Patches 80-86: Windows portability fixes
 *
 * Upstream bun-bundles import.meta.url as literal `file:///home/runner/...`
 * URLs (the CI build machine paths). On macOS/Linux, fileURLToPath returns
 * a POSIX absolute string that "works" even though the file doesn't exist.
 * On Windows, getPathFromURLWin32 throws ERR_INVALID_FILE_URL_PATH because
 * the path lacks a drive letter or UNC prefix — crashing at module load.
 *
 * Same crash applies to module.createRequire(URL) which normalizes via
 * fileURLToPath internally.
 *
 * Fix shape: replace each `<ident>.fileURLToPath("file:///home/runner/...")`
 * with `__filename`, and `<ident>.createRequire("file:///home/runner/...")`
 * with `require`. Both work without re-resolution since the bundle is
 * wrapped in a CJS function with (exports, require, module, __filename,
 * __dirname) — all defined.
 *
 * Downstream consumers do `path.dirname(P)` then resolve siblings (vendor/,
 * cli.js, etc.). With __filename, the resolution anchors at the cli.js
 * bundle directory — a coherent fallback. Missing siblings then trip
 * upstream's existing PATH/env-var lookup chains (USE_BUILTIN_RIPGREP,
 * MODIFIERS_NODE_PATH, etc.) instead of crashing the process.
 *
 * Note: the ripgrep resolver's final-branch hardcoded `arm64-darwin/rg` is
 * an orthogonal bun-fold artifact upstream. Our launchers ensure ripgrep
 * is resolvable via PATH (install.ps1 → ~/.local/bin/rg.exe; brew on macOS;
 * apt/system on Linux).
 */

const BAKED_URLS = [
  // [slug, unique trailing substring of URL]
  ['ripgrep',          'src/utils/ripgrep.ts'],
  ['open',             'node_modules/open/index.js'],
  ['claude-in-chrome', 'src/utils/claudeInChrome/setup.ts'],
  ['computer-use',     'src/utils/computerUse/setup.ts'],
  ['seccomp',          'sandbox-runtime/dist/sandbox/generate-seccomp-filter.js'],
  ['modifiers-napi',   'vendor/modifiers-napi-src/index.ts'],
]

// URLs that ALSO appear in `<ident>.createRequire("file:///home/runner/...")`
// form. Audited Iter 100 (2026-04-23): only modifiers-napi-src has a
// createRequire twin. Adding/removing entries here must be backed by a
// `grep -c createRequire pipeline/build/cli-patched.js` audit pre/post.
const CREATE_REQUIRE_URLS = ['modifiers-napi']

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}

module.exports = function applyCrossPlatform({ patch }) {
  for (const [slug, sub] of BAKED_URLS) {
    // <Ident>.fileURLToPath("file:///home/runner/<...>/<sub>") → __filename
    // Each baked URL appears exactly once at design time — patch helper's
    // first-match replace is fine; future upstream additions of the same
    // URL would land on a second occurrence we'd want to audit by hand.
    patch(`80-windows-url-${slug}`,
      new RegExp(`[\\w$]+\\.fileURLToPath\\("file:\\/\\/\\/home\\/runner\\/[^"]*${escapeRegex(sub)}"\\)`),
      '__filename'
    )
  }

  for (const slug of CREATE_REQUIRE_URLS) {
    const sub = BAKED_URLS.find(([s]) => s === slug)[1]
    // <Ident>.createRequire("file:///home/runner/<...>/<sub>") → require
    // The minified call form is `<L>.createRequire(URL)(H)` where H is the
    // module to load. After replacement: `require(H)`. Equivalent because
    // the bundle's CJS wrapper provides a real require and H is absolute.
    patch(`81-windows-createrequire-${slug}`,
      new RegExp(`[\\w$]+\\.createRequire\\("file:\\/\\/\\/home\\/runner\\/[^"]*${escapeRegex(sub)}"\\)`),
      'require'
    )
  }

  // ── Patches 87-88: Windows shell detection fallback ────────────────────
  //
  // Upstream zs1() hardcodes POSIX shell candidates:
  //   ["/bin", "/usr/bin", "/usr/local/bin", "/opt/homebrew/bin"] × ["bash","zsh"]
  // plus process.env.SHELL and `sT("bash"/"zsh")` auto-detect (which walks PATH).
  // On native Windows (not WSL), SHELL is usually unset and none of those POSIX
  // paths exist — the detection `z.find((Y)=>Y&&pq8(Y))` returns undefined and
  // upstream throws "No suitable shell found. Claude CLI requires a Posix shell
  // environment.", killing sillyx before any tool can run.
  //
  // Git for Windows installs real bash.exe (identical POSIX semantics — it IS
  // bash, MSYS2-compiled) at known locations. Adding those paths to the
  // candidate array keeps the downstream contract intact: upstream's
  // buildExecCommand() emits bash scripts with `; exit $_ec`, `$VAR`
  // expansions, heredoc — all run unmodified under Git Bash. No Windows
  // semantics change.
  //
  // Patch 87 — PREPEND Git Bash candidates to `z` on Windows (conditional on
  //            `process.platform === 'win32'` so non-Windows behavior is
  //            byte-identical). The append-before-find is injected right
  //            before `let w=z.find(...)` at the join seam.
  //
  // Patch 88 — Replace the hard error message with actionable Windows
  //            guidance. Non-Windows error text is preserved verbatim up to
  //            the actionable suffix.
  //
  // Adapter discipline: the injected code only references `process`, `z`
  // (the candidate array already in scope), and `pq8` (the executable-probe
  // function in the same module scope). All three are reachable at the
  // minified injection site — verified by the unique anchor.
  patch('87-windows-shell-candidates',
    'if(q&&pq8(_))z.unshift(_);let w=z.find((Y)=>Y&&pq8(Y));if(!w){',
    'if(q&&pq8(_))z.unshift(_);' +
    'if(process.platform==="win32"){' +
      'var _sillyWinBash=[' +
        '"C:\\\\Program Files\\\\Git\\\\bin\\\\bash.exe",' +
        '"C:\\\\Program Files (x86)\\\\Git\\\\usr\\\\bin\\\\bash.exe",' +
        '"C:\\\\Program Files (x86)\\\\Git\\\\bin\\\\bash.exe",' +
        '(process.env.LOCALAPPDATA||"")+"\\\\Programs\\\\Git\\\\bin\\\\bash.exe",' +
        '(process.env.ProgramW6432||"C:\\\\Program Files")+"\\\\Git\\\\bin\\\\bash.exe"' +
      '];' +
      'for(var _i=_sillyWinBash.length-1;_i>=0;_i--){if(_sillyWinBash[_i]&&pq8(_sillyWinBash[_i]))z.unshift(_sillyWinBash[_i]);}' +
    '}' +
    'let w=z.find((Y)=>Y&&pq8(Y));if(!w){'
  )

  patch('88-windows-shell-error-msg',
    'No suitable shell found. Claude CLI requires a Posix shell environment. Please ensure you have a valid shell installed and the SHELL environment variable set.',
    'No suitable shell found. silly-code requires a POSIX shell (bash/zsh). ' +
    'On Windows: install Git for Windows (https://git-scm.com/download/win) — it ships bash.exe which this CLI will auto-detect. ' +
    'Or use WSL for the best experience. ' +
    'On macOS/Linux: ensure bash or zsh is installed and SHELL points to it.'
  )
}
