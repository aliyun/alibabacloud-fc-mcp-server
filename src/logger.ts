export class Logger {
    silent = false;
  
    constructor({ silent = false }) {
      this.silent = silent;
    }
  
    log(...args: unknown[]) {
      if (this.silent) return;
  
      console.error(...args);
    }
    error(...args: unknown[]) {
      console.error(...args);
    }
    info(...args: unknown[]) {
      this.log(...args);
    }
    debug(...args: unknown[]) {
      this.log(...args);
    }
    warn(...args: unknown[]) {
      this.log(...args);
    }
    write(...args: unknown[]) {
      this.log(...args);
    }
  
    output(...args: unknown[]) {
      this.log(...args);
    }
    spin(...args: unknown[]) {
      this.log(...args);
    }
    tips(...args: unknown[]) {
      this.log(...args);
    }
    append(...args: unknown[]) {
      this.log(...args);
    }
    warnOnce(...args: unknown[]) {
      this.log(...args);
    }
    writeOnce(...args: unknown[]) {
      this.log(...args);
    }
  }
  
  export const logger = new Logger({});