// Settings, kept on this device: the sound as a whole, the music and the menu sounds, each with its volume.
import { APP_VERSION } from '../config';
import { useAuth } from '../lib/auth';
import { CLAN, useSide } from '../lib/clan';
import { setSound, sfx, useSound } from '../lib/sound';
import { Page } from '../components/ui';

function Toggle({ id, label, about, on, onChange, disabled }: { id: string; label: string; about: string; on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`setting ${disabled ? 'is-off' : ''}`} htmlFor={id}>
      <span className="setting__text"><span className="setting__label">{label}</span><small>{about}</small></span>
      <input id={id} className="switch" type="checkbox" role="switch" checked={on} disabled={disabled} onChange={(e) => { onChange(e.target.checked); sfx('hover'); }} />
    </label>
  );
}

function Volume({ id, label, value, onChange, disabled }: { id: string; label: string; value: number; onChange: (v: number) => void; disabled?: boolean }) {
  return (
    <label className={`setting setting--range ${disabled ? 'is-off' : ''}`} htmlFor={id}>
      <span className="setting__label">{label}</span>
      <input id={id} className="range" type="range" min={0} max={100} step={1} value={Math.round(value * 100)} disabled={disabled}
        style={{ ['--v' as any]: `${Math.round(value * 100)}%` }} onChange={(e) => onChange(Number(e.target.value) / 100)} aria-valuetext={`${Math.round(value * 100)} percent`} />
      <span className="setting__value">{Math.round(value * 100)}%</span>
    </label>
  );
}

export default function Settings() {
  const s = useSound();
  const { profile } = useAuth();
  const side = useSide();
  const off = s.muted;
  const playing = profile ? `the ${CLAN[side].adj} theme` : 'the stranger’s theme';
  return (
    <Page title="Settings" sub="Saved on this device">
      <div className="settings">
        <section className="panel">
          <div className="panel__head"><h2 className="panel__title">Sound</h2></div>
          <div className="panel__body">
            <Toggle id="set-sound" label="Sound" about={off ? 'All sound is off.' : 'Music and menu sounds play once you tap anywhere in the app.'} on={!off}
              onChange={(v) => setSound({ muted: !v })} />
          </div>
        </section>
        <section className="panel">
          <div className="panel__head"><h2 className="panel__title">Music</h2></div>
          <div className="panel__body">
            <Toggle id="set-music" label="Music" disabled={off} on={s.music} onChange={(v) => setSound({ music: v })}
              about={`War drums for each clan, playing on its own side of the app. Before anyone signs in, the stranger’s theme plays instead. Now: ${playing}.`} />
            <Volume id="set-music-vol" label="Music volume" disabled={off || !s.music} value={s.musicVolume} onChange={(v) => setSound({ musicVolume: v })} />
          </div>
        </section>
        <section className="panel">
          <div className="panel__head"><h2 className="panel__title">Menu sounds</h2></div>
          <div className="panel__body">
            <Toggle id="set-effects" label="Menu sounds" disabled={off} on={s.effects} onChange={(v) => setSound({ effects: v })}
              about="A knock of wood when you choose, the anvil when something is saved, fire when you praise Malacath." />
            <Volume id="set-effects-vol" label="Menu sound volume" disabled={off || !s.effects} value={s.effectsVolume} onChange={(v) => setSound({ effectsVolume: v })} />
            <button type="button" className="btn btn--small" disabled={off || !s.effects} onClick={() => sfx('select')}>Play a sample</button>
          </div>
        </section>
        <p className="settings__foot">Black Tusk Companion {APP_VERSION}</p>
      </div>
    </Page>
  );
}
