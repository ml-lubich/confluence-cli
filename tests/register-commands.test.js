const registerBulkCommands = require('../bin/commands/bulk');
const registerMirrorCommand = require('../bin/commands/mirror');

// A minimal chainable stand-in for a commander program/command, so we can
// exercise the registration functions (option wiring, help text) without a real
// CLI parse.
function fakeProgram() {
  const cmd = {};
  for (const m of ['command', 'description', 'option', 'requiredOption', 'addHelpText', 'action']) {
    cmd[m] = () => cmd;
  }
  return cmd;
}

describe('command registration', () => {
  const deps = { withClient: (name, fn) => fn };

  test('registerBulkCommands wires up without throwing', () => {
    expect(() => registerBulkCommands(fakeProgram(), deps)).not.toThrow();
  });

  test('registerMirrorCommand wires up without throwing', () => {
    expect(() => registerMirrorCommand(fakeProgram(), deps)).not.toThrow();
  });
});
