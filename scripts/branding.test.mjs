import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'

const root = new URL('..', import.meta.url)
const read = (relativePath) => fs.readFileSync(new URL(relativePath, root), 'utf8')

test('native mark keeps the approved geometry and motion states', () => {
  const mark = read('components/brand/OverlayMark.tsx')
  const geometry = read('lib/overlayBrand.ts')
  assert.match(mark, /viewBox="43 -815 860 860"/)
  assert.match(mark, /motion === 'look'/)
  assert.match(mark, /motion === 'blink'/)
  assert.match(geometry, /export const BODY =/)
  assert.match(geometry, /export const EYES =/)
  assert.match(geometry, /export const SMALL_EYES =/)
})

test('default agents use explicit identity and regular agents retain creatures', () => {
  const creature = read('components/agents/AgentCreature.tsx')
  assert.match(creature, /isDefault = false/)
  assert.match(creature, /motion="blink"/)
  assert.match(creature, /<Svg width=\{size\}/)
  assert.match(read('lib/agentByo.ts'), /Boolean\(agent\?\.isDefault\)/)
  assert.doesNotMatch(read('lib/agentByo.ts'), /name\.toLowerCase\(\)/)
})

test('native assets preserve their configured dimensions and platform alpha rules', () => {
  const assets = [
    ['assets/icon.png', 1024, 1024, 2],
    ['assets/adaptive-icon.png', 1024, 1024, 6],
    ['assets/splash-icon.png', 1024, 1024, 6],
    ['assets/favicon.png', 48, 48, 2],
    ['assets/notification-icon.png', 64, 64, 6],
    ['ios/Overlay/Images.xcassets/AppIcon.appiconset/App-Icon-1024x1024@1x.png', 1024, 1024, 2],
  ]
  for (const [path, width, height, colorType] of assets) {
    const png = fs.readFileSync(new URL(path, root))
    assert.equal(png.toString('ascii', 1, 4), 'PNG')
    assert.equal(png.readUInt32BE(16), width, path)
    assert.equal(png.readUInt32BE(20), height, path)
    assert.equal(png[25], colorType, path)
  }
})
