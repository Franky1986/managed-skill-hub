import { mkdir, readFile, writeFile } from 'node:fs/promises';

interface CheckResult {
  id: string;
  passed: true;
  evidence: string[];
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function includesAll(source: string, fragments: string[], label: string): string[] {
  const evidence: string[] = [];
  for (const fragment of fragments) {
    assert(source.includes(fragment), label + ' missing fragment: ' + fragment);
    evidence.push(fragment);
  }
  return evidence;
}

async function main(): Promise<void> {
  const [router, layout, loginPage, authStore, howTo, proposalDetail, proposalStatus, judgementPanel, judgementLib, messages, adminProposals, adminSkillPage, adminDashboard, apiClient, adminApi, backgroundPolling] = await Promise.all([
    readFile('apps/web/src/router.tsx', 'utf8'),
    readFile('apps/web/src/components/Layout.tsx', 'utf8'),
    readFile('apps/web/src/pages/admin/AdminLoginPage.tsx', 'utf8'),
    readFile('apps/web/src/store/auth.ts', 'utf8'),
    readFile('apps/web/src/pages/HowToProposePage.tsx', 'utf8'),
    readFile('apps/web/src/pages/ProposalDetailPage.tsx', 'utf8'),
    readFile('apps/web/src/pages/ProposalStatusPage.tsx', 'utf8'),
    readFile('apps/web/src/components/JudgementPanel.tsx', 'utf8'),
    readFile('apps/web/src/lib/judgement.ts', 'utf8'),
    readFile('apps/web/src/i18n/messages.ts', 'utf8'),
    readFile('apps/web/src/pages/admin/AdminProposalsPage.tsx', 'utf8'),
    readFile('apps/web/src/pages/admin/AdminSkillPage.tsx', 'utf8'),
    readFile('apps/web/src/pages/admin/AdminDashboardPage.tsx', 'utf8'),
    readFile('apps/web/src/api/client.ts', 'utf8'),
    readFile('apps/web/src/api/admin.ts', 'utf8'),
    readFile('apps/web/src/hooks/useBackgroundPolling.ts', 'utf8'),
  ]);

  const results: CheckResult[] = [];

  results.push({
    id: 'public-routes-outside-admin-guard',
    passed: true,
    evidence: includesAll(router, [
      'path="how-to-propose" element={<HowToProposePage />}',
      'path="skills/:id" element={<SkillDetailPage />}',
      'path="search" element={<SearchPage />}',
      'path="proposals/status/:id" element={<ProposalStatusPage />}',
      'path="admin" element={<AdminRoute />}',
      '<Navigate to="/admin/login?reason=session-expired" replace />',
    ], 'router public/admin route contract'),
  });

  results.push({
    id: 'admin-nav-hidden-for-anonymous-users',
    passed: true,
    evidence: includesAll(layout, [
      '!isLoading &&',
      'isAuthenticated ? (',
      'to="/admin/proposals"',
      'to="/admin/drafts"',
      'to="/admin/review"',
      'to="/admin/login"',
      "t('app.nav.signIn')",
    ], 'layout admin nav auth gate'),
  });

  results.push({
    id: 'admin-login-and-logout-wired',
    passed: true,
    evidence: [
      ...includesAll(loginPage, ['await login(username, password)', "navigate('/admin')", "t('adminLogin.failed')"], 'admin login page'),
      ...includesAll(authStore, ['await adminApi.login(username, password)', 'await adminApi.getSession()', 'await adminApi.logout()', 'set({ isAuthenticated: false, username: null, displayName: null, roles: [], mode: null })'], 'auth store'),
      ...includesAll(layout, ['const handleLogout = () =>', 'void logout()', "navigate('/admin/login', { replace: true })", "t('app.nav.signOut')"], 'layout logout'),
    ],
  });

  results.push({
    id: 'oidc-login-session-and-role-gates',
    passed: true,
    evidence: [
      ...includesAll(loginPage, [
        "methods?.mode === 'oidc'",
        'methods.loginStartUrl',
        "target.searchParams.set('returnTo', methods.adminUiBasePath)",
        "t('adminLogin.sessionExpired')",
      ], 'OIDC admin login page'),
      ...includesAll(authStore, [
        "roles.includes('admin')",
        'requiredRoles.some((role) => roles.includes(role))',
        'roles: session.data.roles',
      ], 'admin role session state'),
      ...includesAll(router, [
        'function AdminRoleRoute',
        '<AdminRoleRoute required="admin" />',
        '<AdminRoleRoute required="reviewer" />',
        "<AdminRoleRoute required={['reviewer', 'publisher']} />",
      ], 'admin role routes'),
      ...includesAll(layout, [
        'const canReview =',
        '{canReview && <Link',
        'adminApi',
        '.proposalNotice(signal)',
        'const shouldPollProposalNotice = !isLoading && isAuthenticated && canReview',
      ], 'reviewer navigation and admin notice boundary'),
      ...includesAll(adminApi, [
        "apiClient.get<{ hasNewProposals: boolean; totalPending: number }>('/admin/proposals/notice', { signal })",
      ], 'admin proposal notice API'),
      ...includesAll(adminDashboard, ['const canViewOperations =', '{canViewOperations && <section'], 'admin operations visibility'),
      ...includesAll(adminSkillPage, [
        "const canAdmin = hasAdminRole(roles, 'admin')",
        "const canReview = hasAdminRole(roles, 'reviewer')",
        "const canPublish = hasAdminRole(roles, 'publisher')",
        '{canPublish && <button',
        '{canReview && <button',
      ], 'skill action role visibility'),
      ...includesAll(proposalDetail, ['{f.extractable && canReview && ('], 'proposal reviewer action visibility'),
    ],
  });

  results.push({
    id: 'config-aware-agent-setup-guidance',
    passed: true,
    evidence: [
      ...includesAll(howTo, ['guide.apiNotes?.credentialSetupScriptUrl &&', 'href={guide.apiNotes.credentialSetupScriptUrl}', 'download', 'guide.apiNotes?.authSetupFlow', "t('howTo.auth.tokenChat')", "t('howTo.auth.never')"], 'how-to-propose setup guidance'),
      ...includesAll(apiClient, ['credentialSetupScriptUrl', 'auth area:', 'setup:'], 'api client auth error setup guidance'),
      ...includesAll(messages, ["'howTo.auth.downloadSetup'", "'howTo.auth.never'"], 'setup i18n copy'),
    ],
  });

  results.push({
    id: 'not-judged-state-visible',
    passed: true,
    evidence: [
      ...includesAll(judgementLib, ["risk === 'no_judge_available'", "translate('judgement.notJudged')", "translate('judgement.noJudgeHint')"], 'judgement helpers'),
      ...includesAll(proposalDetail, ["formatOverallRiskLabel(currentProposal.review.latestJudgementRisk, t, t('proposalDetail.notJudged'))", 'isNoJudgeAvailable(currentProposal.review.latestJudgementRisk)', 'noJudgeHint(t)'], 'proposal detail not judged state'),
      ...includesAll(judgementPanel, ["risk === 'no_judge_available'", 'bg-gray-100 text-gray-700'], 'judgement panel no judge badge'),
      ...includesAll(messages, ["'judgement.notJudged': 'not judged'", "'judgement.noJudgeHint'", "'proposalDetail.notJudged': 'not judged'"], 'not judged i18n copy'),
    ],
  });

  results.push({
    id: 'admin-proposal-review-and-draft-flow-reachable',
    passed: true,
    evidence: [
      ...includesAll(router, ['path="proposals" element={<AdminProposalsPage />}', 'path="proposals/:id" element={<ProposalDetailPage />}', 'path="skills/new" element={<AdminSkillCreatePage />}', 'path="skills/:id" element={<AdminSkillPage />}'], 'admin routes'),
      ...includesAll(adminProposals, ['adminApi.listProposals', '/admin/proposals/', 'fromProposal=1', 'mode=view'], 'admin proposals links'),
      ...includesAll(adminSkillPage, ['adminApi.convertProposal', 'handleFinalizeProposal', 'finalize-proposal', 'skillHub:proposalDecision'], 'admin skill proposal finalization'),
    ],
  });

  results.push({
    id: 'proposal-background-polling',
    passed: true,
    evidence: [
      ...includesAll(backgroundPolling, [
        'BACKGROUND_POLL_INTERVAL_MS = 10_000',
        'if (!active || inFlight)',
        'window.setInterval',
        'controller?.abort()',
      ], 'background polling lifecycle'),
      ...includesAll(layout, ['useBackgroundPolling(refreshProposalNotice, shouldPollProposalNotice)'], 'proposal notice polling'),
      ...includesAll(adminProposals, ['useBackgroundPolling(refreshProposals)'], 'admin proposal list polling'),
      ...includesAll(proposalDetail, ['useBackgroundPolling(refreshProposal, Boolean(id))'], 'admin proposal detail polling'),
      ...includesAll(proposalStatus, ['useBackgroundPolling(refreshStatus, Boolean(id))'], 'public proposal status polling'),
    ],
  });

  const report = { name: 'admin-ui-smoke', mode: 'source-contract', totalChecks: results.length, passedChecks: results.length, failedChecks: 0, results };
  const lines = ['admin-ui-smoke', 'mode=' + report.mode, 'totalChecks=' + report.totalChecks, 'passedChecks=' + report.passedChecks, 'failedChecks=' + report.failedChecks, ...results.map((result) => 'PASS ' + result.id + ' evidence=' + result.evidence.length), 'RESULT=PASS'];
  await mkdir('.tmp', { recursive: true });
  await writeFile('.tmp/admin-ui-smoke.json', JSON.stringify(report, null, 2) + '\n');
  await writeFile('.tmp/admin-ui-smoke.log', lines.join('\n') + '\n');
  console.log(lines.join('\n'));
}

main().catch((error) => {
  console.error('RESULT=FAIL');
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
