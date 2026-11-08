// 极简事件总线
export class Events {
  constructor() {
    this.handlers = new Map();
  }

  on(name, fn) {
    if (!this.handlers.has(name)) this.handlers.set(name, new Set());
    this.handlers.get(name).add(fn);
    return () => this.handlers.get(name)?.delete(fn);
  }

  emit(name, payload) {
    this.handlers.get(name)?.forEach((fn) => {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[events] ${name}`, err);
      }
    });
  }
}
