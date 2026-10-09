// src/__tests__/analyticsRegistry.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  resolveCommand,
  getAvailableCommandsForBusiness,
  COMMAND_REGISTRY,
} from '../services/analyticsRegistry.service';

describe('Analytics Command Registry', () => {
  it('should resolve canonical command names', () => {
    const reportCmd = resolveCommand('/report');
    assert.ok(reportCmd);
    assert.strictEqual(reportCmd?.name, '/report');

    const salesCmd = resolveCommand('/sales');
    assert.ok(salesCmd);
    assert.strictEqual(salesCmd?.name, '/sales');

    const profitCmd = resolveCommand('/profit');
    assert.ok(profitCmd);
    assert.strictEqual(profitCmd?.name, '/profit');

    const dueCmd = resolveCommand('/due');
    assert.ok(dueCmd);
    assert.strictEqual(dueCmd?.name, '/due');

    const inventoryCmd = resolveCommand('/inventory');
    assert.ok(inventoryCmd);
    assert.strictEqual(inventoryCmd?.name, '/inventory');
  });

  it('should resolve Bengali and English command aliases', () => {
    const bikri = resolveCommand('/bikri');
    assert.ok(bikri);
    assert.strictEqual(bikri?.name, '/sales');

    const labh = resolveCommand('/labh');
    assert.ok(labh);
    assert.strictEqual(labh?.name, '/profit');

    const khoroch = resolveCommand('/khoroch');
    assert.ok(khoroch);
    assert.strictEqual(khoroch?.name, '/expense');

    const baki = resolveCommand('/baki');
    assert.ok(baki);
    assert.strictEqual(baki?.name, '/due');

    const stock = resolveCommand('/stock');
    assert.ok(stock);
    assert.strictEqual(stock?.name, '/inventory');
  });

  it('should return null for unknown commands', () => {
    assert.strictEqual(resolveCommand('/unknownCommand123'), null);
    assert.strictEqual(resolveCommand('/hackDatabase'), null);
  });

  it('should filter commands based on business type', () => {
    // Retail/Business mode has /sales, /profit, /inventory, /due
    const businessCommands = getAvailableCommandsForBusiness('business', 'owner');
    const commandNames = businessCommands.map((c) => c.name);
    assert.ok(commandNames.includes('/sales'));
    assert.ok(commandNames.includes('/profit'));
    assert.ok(commandNames.includes('/inventory'));
    assert.ok(commandNames.includes('/due'));

    // Personal cashbook should NOT have /sales, /inventory, /purchase
    const personalCommands = getAvailableCommandsForBusiness('personal', 'owner');
    const personalNames = personalCommands.map((c) => c.name);
    assert.ok(personalNames.includes('/expense'));
    assert.ok(personalNames.includes('/income'));
    assert.ok(personalNames.includes('/balance'));
    assert.strictEqual(personalNames.includes('/sales'), false);
    assert.strictEqual(personalNames.includes('/inventory'), false);
    assert.strictEqual(personalNames.includes('/purchase'), false);
  });

  it('should enforce role restrictions on sensitive commands', () => {
    // /profit is restricted to owner and admin
    const ownerCommands = getAvailableCommandsForBusiness('business', 'owner');
    assert.ok(ownerCommands.some((c) => c.name === '/profit'));

    const adminCommands = getAvailableCommandsForBusiness('business', 'admin');
    assert.ok(adminCommands.some((c) => c.name === '/profit'));

    const memberCommands = getAvailableCommandsForBusiness('business', 'member');
    assert.strictEqual(memberCommands.some((c) => c.name === '/profit'), false);
  });

  it('should provide visualization candidates and default visualization for all commands', () => {
    for (const [name, def] of Object.entries(COMMAND_REGISTRY)) {
      assert.ok(def.visualizationCandidates.length > 0, `${name} has no visualization candidates`);
      assert.ok(
        def.visualizationCandidates.includes(def.defaultVisualization),
        `${name} default visualization is not in candidates`,
      );
      assert.ok(def.examples.length > 0, `${name} has no examples`);
      assert.ok(def.examples[0].en, `${name} missing English example`);
      assert.ok(def.examples[0].bn, `${name} missing Bengali example`);
    }
  });
});
