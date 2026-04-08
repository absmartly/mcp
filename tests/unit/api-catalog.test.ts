import {
  CLI_GROUPS,
  searchCommands,
  getGroupCommands,
  getCommandEntry,
  getGroupSummary,
  getTotalCommandCount,
} from '../../src/cli-catalog';

export default async function runTests() {
  let passed = 0;
  let failed = 0;
  const details: Array<{ name: string; status: string; error?: string }> = [];

  function assert(condition: boolean, name: string, error: string = 'Assertion failed') {
    if (condition) {
      passed++;
      details.push({ name, status: 'PASS' });
    } else {
      failed++;
      details.push({ name, status: 'FAIL', error });
    }
  }

  const totalCommands = getTotalCommandCount();
  assert(totalCommands > 150, 'catalog has 150+ commands', `Got ${totalCommands}`);

  // All groups have commands with required fields
  for (const group of CLI_GROUPS) {
    const commands = getGroupCommands(group);
    assert(commands.length > 0, `group "${group}" has commands`, `${group} has 0`);

    for (const cmd of commands) {
      assert(!!cmd.command, `${group}.${cmd.command} has command name`);
      assert(!!cmd.group, `${group}.${cmd.command} has group`);
      assert(!!cmd.description, `${group}.${cmd.command} has description`);
      assert(Array.isArray(cmd.params), `${group}.${cmd.command} has params array`);
      assert(!!cmd.returns, `${group}.${cmd.command} has returns`);
    }
  }

  // No duplicate command names within a group
  for (const group of CLI_GROUPS) {
    const commands = getGroupCommands(group);
    const names = commands.map(c => c.command);
    const unique = new Set(names);
    assert(names.length === unique.size, `no duplicate commands in "${group}"`, `${names.length} total vs ${unique.size} unique`);
  }

  // Search works
  const searchResults = searchCommands('createMetric');
  assert(searchResults.some(r => r.command === 'createMetric'), 'search finds createMetric');

  const archiveResults = searchCommands('archive');
  assert(archiveResults.length > 3, 'search "archive" finds multiple results', `Got ${archiveResults.length}`);

  // Get group commands
  const teamCommands = getGroupCommands('teams');
  assert(teamCommands.length >= 5, 'teams group has 5+ commands', `Got ${teamCommands.length}`);

  // Get specific command entry
  const entry = getCommandEntry('experiments', 'listExperiments');
  assert(entry !== undefined, 'getCommandEntry finds experiments.listExperiments');
  assert(entry?.group === 'experiments', 'listExperiments is in experiments group');

  assert(getCommandEntry('experiments', 'nonExistentCommand') === undefined, 'getCommandEntry returns undefined for unknown command');
  assert(getCommandEntry('nonExistentGroup', 'list') === undefined, 'getCommandEntry returns undefined for unknown group');

  // Summary
  const summary = getGroupSummary();
  assert(summary.length === CLI_GROUPS.length, 'summary has all groups', `Got ${summary.length} vs ${CLI_GROUPS.length}`);
  assert(summary.every(s => s.commands.length > 0), 'every group in summary has commands');

  // Dangerous commands
  const allCommands = CLI_GROUPS.flatMap(g => getGroupCommands(g));
  const dangerousCommands = allCommands.filter(c => c.dangerous);
  assert(dangerousCommands.length > 0, 'some commands are marked dangerous');
  assert(dangerousCommands.some(c => c.command === 'archiveExperiment'), 'archiveExperiment is dangerous');

  // Param validation
  for (const cmd of allCommands) {
    for (const param of cmd.params) {
      assert(!!param.name, `${cmd.group}.${cmd.command}.${param.name} has name`);
      assert(!!param.type, `${cmd.group}.${cmd.command}.${param.name} has type`);
      assert(typeof param.required === 'boolean', `${cmd.group}.${cmd.command}.${param.name} has boolean required`);
      assert(!!param.description, `${cmd.group}.${cmd.command}.${param.name} has description`);
    }
  }

  // Specific entries exist
  const corsEntry = getCommandEntry('cors', 'getCorsOrigin');
  assert(corsEntry !== undefined, 'cors.getCorsOrigin exists');

  const goalTagEntry = getCommandEntry('goaltags', 'getGoalTag');
  assert(goalTagEntry !== undefined, 'goaltags.getGoalTag exists');

  const metricTagEntry = getCommandEntry('metrictags', 'getMetricTag');
  assert(metricTagEntry !== undefined, 'metrictags.getMetricTag exists');

  return {
    success: failed === 0,
    message: `${passed} passed, ${failed} failed`,
    testCount: passed + failed,
    details
  };
}
