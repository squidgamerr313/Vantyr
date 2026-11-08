/** Camera startup is always opt-in; only an explicit simulation link can play scripted input. */
export function initialMonitorMode(search: string): 'off' | 'demo' {
  return new URLSearchParams(search).get('source') === 'simulation' ? 'demo' : 'off';
}
