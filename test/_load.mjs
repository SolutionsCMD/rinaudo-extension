// Loads an adapter IIFE under stubbed globals and returns the adapter object it
// registers. Only `self` matters at load time (the adapter assigns its global and
// checks self.EngageCore); DOM-touching methods are never called here.
import { readFileSync } from 'node:fs';

export function loadAdapter(file, globalName) {
  const code = readFileSync(file, 'utf8');
  const self = {};
  // location/document are referenced only inside methods we don't call; pass harmless stubs.
  new Function('self', 'location', 'document', code)(self, { pathname: '/' }, {});
  return self[globalName];
}
