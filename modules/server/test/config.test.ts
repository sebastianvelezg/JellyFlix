import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { originsOf } from '../src/config.ts'

describe('the sites allowed to call the container from a browser', () => {
  it('are the ones listed', () => {
    assert.deepEqual(originsOf('http://a.test, http://b.test', false), ['http://a.test', 'http://b.test'])
    assert.deepEqual(originsOf('http://a.test', true), ['http://a.test'])
  })

  it('are any when nothing is said, except behind the web image\'s proxy, where nobody needs to cross sites', () => {
    assert.deepEqual(originsOf('', false), ['*'])
    assert.deepEqual(originsOf('', true), [])
  })
})
