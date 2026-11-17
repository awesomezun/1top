import assert from 'node:assert/strict';
import {relayOrigin,socketForRelay,MANAGED_RELAY} from '../site/src/relay-settings.js';
for(const bad of ['http://relay.example','https://a:b@relay.example','https://relay.example/path','https://relay.example/?secret=1','https://relay.example:8443'])assert.throws(()=>relayOrigin(bad));
assert.equal(relayOrigin('https://own.workers.dev/'),'https://own.workers.dev');
assert.throws(()=>socketForRelay('wss://other.workers.dev/api/live',MANAGED_RELAY));
assert.equal(socketForRelay('wss://own.workers.dev/api/live','https://own.workers.dev'),'wss://own.workers.dev/api/live');
console.log('Relay origin and credential destination boundaries passed');
