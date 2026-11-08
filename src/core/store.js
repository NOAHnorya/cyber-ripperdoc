import { clampReputation } from '../systems/economy.js';

const SAVE_KEY = 'neon-ripperdoc-save-v1';

function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

// 游戏进度：钱、口碑、第几晚、升级等级、手术记录
export class Store {
  constructor(balance) {
    this.balance = balance;
    this.state = Store.fresh(balance);
  }

  static fresh(balance) {
    return {
      night: 1,
      money: balance.startMoney,
      reputation: balance.reputation.start,
      upgrades: {},
      history: [],
      incidents: [],
      incidentChoices: {},
    };
  }

  reset() {
    this.state = Store.fresh(this.balance);
    this.clearSave();
  }

  level(key) {
    return this.state.upgrades[key] ?? 0;
  }

  addMoney(amount) {
    this.state.money += amount;
  }

  addReputation(delta) {
    this.state.reputation = clampReputation(this.state.reputation + delta, this.balance);
  }

  record(entry) {
    this.state.history.push(entry);
  }

  lastRecordFor(customerId) {
    for (let i = this.state.history.length - 1; i >= 0; i--) {
      if (this.state.history[i].customerId === customerId) return this.state.history[i];
    }
    return null;
  }

  hasSave() {
    try {
      return Boolean(storage()?.getItem(SAVE_KEY));
    } catch {
      return false;
    }
  }

  save() {
    try {
      storage()?.setItem(SAVE_KEY, JSON.stringify(this.state));
    } catch (err) {
      console.warn('[store] save failed', err);
    }
  }

  load() {
    try {
      const raw = storage()?.getItem(SAVE_KEY);
      if (!raw) return false;
      this.state = { ...Store.fresh(this.balance), ...JSON.parse(raw) };
      return true;
    } catch (err) {
      console.warn('[store] load failed', err);
      return false;
    }
  }

  clearSave() {
    try {
      storage()?.removeItem(SAVE_KEY);
    } catch {
      /* 存储不可用时忽略 */
    }
  }
}
