import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'


test('wires Competitor Radar navigation and automatic rule management', async () => {
  const appSource = await readFile(new URL('./App.jsx', import.meta.url), 'utf8')
  const radarSource = await readFile(new URL('./CompetitorRadar.jsx', import.meta.url), 'utf8')
  const jobCenterSource = await readFile(new URL('./JobCenter.jsx', import.meta.url), 'utf8')

  assert.match(appSource, /import CompetitorRadar from ['"]\.\/CompetitorRadar['"]/)
  assert.match(appSource, /activeView === ['"]competitors['"]/)
  assert.match(appSource, />Radar đối thủ<\/li>/)
  assert.match(appSource, /<CompetitorRadar[\s\S]*?\/>/)
  assert.match(radarSource, /request\(['"]\/competitors\/rules['"]/)
  assert.match(radarSource, /\/scan`/)
  assert.match(radarSource, /\/status`/)
  assert.match(radarSource, /\/competitors\/history/)
  assert.match(radarSource, /\/casting`/)
  assert.match(radarSource, /\/qc`/)
  assert.match(radarSource, /publication_mode/)
  assert.match(radarSource, /manual_windows/)
  assert.match(jobCenterSource, /value="competitor_scan"/)
  assert.match(jobCenterSource, /value="video_qc"/)
})


test('TTS catalog exposes profile-based auto-cast metadata', async () => {
  const source = await readFile(new URL('./TTSSettings.jsx', import.meta.url), 'utf8')

  assert.match(source, /casting_profile/)
  assert.match(source, /auto_cast/)
  assert.match(source, /gender/)
  assert.match(source, /age_group/)
  assert.match(source, /languages/)
  assert.match(source, /roles/)
  assert.match(source, /styles/)
})
