/// <reference types="cypress" />

declare namespace Cypress {
  interface Cypress {
    cy?: Chainable;
  }

  interface Chainable {
    /**
     * Clear all IndexedDB databases to ensure clean test state
     * This removes stale document caches from y-indexeddb and the app's Dexie cache
     */
    clearAllIndexedDB(): Chainable<void>;
  }

  // Fix for uncaught:exception event
  interface Actions {
    (action: 'uncaught:exception', fn: (err: Error, runnable?: any) => boolean | void): void;
  }
}

// Augment Cypress types to properly type jQuery results
declare global {
  namespace Cypress {
    interface JQuery<TElement = HTMLElement> extends JQuery<TElement> {
      [index: number]: TElement;
      length: number;
      each(fn: (index: number, elem: TElement) => void): JQuery<TElement>;
      filter(fn: (index: number, elem: TElement) => boolean): JQuery<TElement>;
      find(selector: string): JQuery<TElement>;
      text(): string;
      attr(name: string): string | undefined;
      last(): JQuery<TElement>;
    }
    
    // Fix Subject type to include response properties
    interface Response<T = any> {
      status: number;
      body: T;
      headers: { [key: string]: string };
    }
  }
}

export {};