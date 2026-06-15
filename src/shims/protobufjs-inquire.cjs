'use strict';

// Browser bundles cannot load optional Node modules through protobufjs' dynamic require.
module.exports = function inquire() {
  return null;
};
