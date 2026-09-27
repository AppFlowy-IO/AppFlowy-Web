// jsdom's InputEvent has no `getTargetRanges`, so slate-react, which checks
// for it when it loads, would not listen to `beforeinput`. Import this before
// slate-react. Target ranges are empty: edits apply at the Slate selection.
if (typeof InputEvent !== 'undefined' && typeof InputEvent.prototype.getTargetRanges !== 'function') {
  Object.defineProperty(InputEvent.prototype, 'getTargetRanges', {
    configurable: true,
    value: () => [],
  });
}

export {};
