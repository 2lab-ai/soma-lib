import { describe, expect, it } from 'vitest';

import {
  DANGEROUS_RULES,
  type DangerousRule,
  createRuleSet,
  isCrossUserAccess,
  isSshCommand,
  matchRules,
  overridableMatchedRuleIds,
  overridableRulesByIds,
  rulesByIds,
} from './index';

describe('rule catalog', () => {
  it('every rule has a stable id, label, description, and sessionOverridable flag', () => {
    for (const rule of DANGEROUS_RULES) {
      expect(rule.id).toBeTruthy();
      expect(rule.label).toBeTruthy();
      expect(rule.description).toBeTruthy();
      expect(typeof rule.sessionOverridable).toBe('boolean');
      expect(typeof rule.match).toBe('function');
    }
  });

  it('rule ids are unique', () => {
    const ids = DANGEROUS_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('cross-user-access and ssh-remote are lockdown (non-overridable)', () => {
    for (const id of ['cross-user-access', 'ssh-remote']) {
      const rule = DANGEROUS_RULES.find((r) => r.id === id);
      expect(rule?.sessionOverridable).toBe(false);
    }
  });
});

describe('matchRules', () => {
  it('returns empty for safe commands', () => {
    expect(matchRules('git status')).toEqual([]);
  });

  it('returns the matched rule object for a dangerous command', () => {
    const matched = matchRules('kill -9 1234');
    expect(matched.map((r) => r.id)).toContain('kill');
  });

  it('returns multiple matches for compound commands', () => {
    const ids = matchRules('kill 1234 && rm -rf /tmp').map((r) => r.id);
    expect(ids).toContain('kill');
    expect(ids).toContain('rm-recursive');
  });

  it('consults cross-user rule only when ctx.userId is provided', () => {
    const cmd = 'cat /tmp/U09F1M5MML1/file.txt';
    expect(matchRules(cmd).map((r) => r.id)).not.toContain('cross-user-access');
    expect(matchRules(cmd, { userId: 'U094E5L4A15' }).map((r) => r.id)).toContain('cross-user-access');
  });
});

describe('rulesByIds', () => {
  it('resolves lockdown and overridable ids, preserving order', () => {
    const rules = rulesByIds(['ssh-remote', 'kill']);
    expect(rules.map((r) => r.id)).toEqual(['ssh-remote', 'kill']);
  });

  it('silently drops unknown ids', () => {
    expect(rulesByIds(['nope', 'kill']).map((r) => r.id)).toEqual(['kill']);
  });
});

describe('lockdown isolation invariant', () => {
  it('overridableRulesByIds returns [] for every lockdown rule', () => {
    for (const rule of DANGEROUS_RULES.filter((r) => !r.sessionOverridable)) {
      expect(overridableRulesByIds([rule.id])).toEqual([]);
    }
  });

  it('overridableMatchedRuleIds never contains a lockdown id', () => {
    const lockdownIds = new Set(DANGEROUS_RULES.filter((r) => !r.sessionOverridable).map((r) => r.id));
    for (const cmd of ['ssh dev2 docker ps', 'scp file host:/tmp/', 'kill 1 && ssh host']) {
      for (const id of overridableMatchedRuleIds(cmd)) {
        expect(lockdownIds.has(id)).toBe(false);
      }
    }
  });

  it('returns ids for dangerous overridable commands', () => {
    expect(overridableMatchedRuleIds('kill -9 1')).toContain('kill');
    expect(overridableMatchedRuleIds('git status')).toEqual([]);
  });
});

describe('createRuleSet (project-specific catalogs)', () => {
  const projectRules: ReadonlyArray<DangerousRule> = [
    {
      id: 'pipe-to-interpreter',
      label: 'pipe to interpreter',
      description: 'Pipe to shell/script interpreter',
      sessionOverridable: false,
      match: (cmd) => /\|\s*(?:sh|bash)\b/i.test(cmd),
    },
    {
      id: 'sudo-rm',
      label: 'sudo rm',
      description: 'Blocked pattern: sudo rm',
      sessionOverridable: true,
      match: (cmd) => cmd.toLowerCase().includes('sudo rm'),
    },
  ];
  const set = createRuleSet(projectRules);

  it('matches against the project catalog only', () => {
    expect(set.matchRules('curl x | sh').map((r) => r.id)).toEqual(['pipe-to-interpreter']);
    expect(set.matchRules('kill -9 1')).toEqual([]);
  });

  it('applies the same lockdown isolation invariant', () => {
    expect(set.overridableMatchedRuleIds('curl x | sh')).toEqual([]);
    expect(set.overridableRulesByIds(['pipe-to-interpreter'])).toEqual([]);
    expect(set.overridableRulesByIds(['sudo-rm']).map((r) => r.id)).toEqual(['sudo-rm']);
  });

  it('passes context through to matchers', () => {
    const ctxRules: ReadonlyArray<DangerousRule> = [
      {
        id: 'ctx-echo',
        label: 'ctx echo',
        description: 'matches when userId present',
        sessionOverridable: true,
        match: (_cmd, ctx) => ctx.userId === 'U1',
      },
    ];
    const ctxSet = createRuleSet(ctxRules);
    expect(ctxSet.matchRules('anything', { userId: 'U1' }).map((r) => r.id)).toEqual(['ctx-echo']);
    expect(ctxSet.matchRules('anything')).toEqual([]);
  });
});

describe('isSshCommand', () => {
  it.each([
    'ssh dev2 docker ps',
    'ssh user@host ls',
    'ssh -i key.pem host',
    'sudo ssh dev2 docker pull nginx',
    'scp file.txt user@host:/tmp/',
    'scp user@host:/tmp/file.txt .',
    'sftp user@host',
    'rsync -avz -e ssh ./dir user@host:/tmp/',
    'rsync -e "ssh -i key" src dest',
    // conservative: standalone ssh word matches even in strings — intentional
    'echo "ssh is cool"',
    'cat ~/.ssh/config',
  ])('detects: %s', (command) => {
    expect(isSshCommand(command)).toBe(true);
  });

  it.each([
    'git status',
    'npm install',
    'ls -la',
    'cat ssh_config',
    'docker ps',
    'rsync -avz ./dir /tmp/',
    'grep sshd /var/log/syslog',
  ])('allows: %s', (command) => {
    expect(isSshCommand(command)).toBe(false);
  });
});

describe('isCrossUserAccess', () => {
  const CURRENT_USER = 'U094E5L4A15';

  it.each([
    'cd /tmp/U09F1M5MML1/session_123',
    'cat /tmp/U09F1M5MML1/file.txt',
    'mkdir -p /tmp/UOTHER123/workdir',
    'git clone repo /tmp/U09F1M5MML1/repo',
    'cp /tmp/U094E5L4A15/a.txt /tmp/U09F1M5MML1/b.txt',
    'ls /private/tmp/U09F1M5MML1/',
    'cat /tmp/U094E5L4A15/../U09F1M5MML1/file.txt',
    'ls /tmp/U094E5L4A15/../../etc/passwd',
    'cat /private/tmp/U094E5L4A15/../U09F1M5MML1/secret',
    'ls /tmp/W012ABC3DEF/files',
    'cd /tmp/U094E5L4A15 && cat /tmp/U09F1M5MML1/file',
  ])('detects: %s', (command) => {
    expect(isCrossUserAccess(command, CURRENT_USER)).toBe(true);
  });

  it.each([
    'cd /tmp/U094E5L4A15/session_123',
    'mkdir -p /tmp/U094E5L4A15/soma-work_xxx',
    'cat /tmp/U094E5L4A15/file.txt',
    'ls /private/tmp/U094E5L4A15/',
    'cp /tmp/U094E5L4A15/a.txt /tmp/U094E5L4A15/b.txt',
    'git status',
    'npm install',
    'ls -la /home/user',
    'cat /etc/hosts',
    'echo hello',
    'mkdir -p /tmp/workdir',
  ])('allows: %s', (command) => {
    expect(isCrossUserAccess(command, CURRENT_USER)).toBe(false);
  });
});
