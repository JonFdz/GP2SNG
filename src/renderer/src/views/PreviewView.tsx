import { useEffect, useMemo, useRef, useState } from 'react';
import {
  barDivisionTicks,
  barStartTicks,
  beatEvents,
  type ChartError,
  convertToYargChart,
  playedBars,
  tickToSeconds,
} from '../../../shared/convert/index';
import {
  applyRemap,
  lookup,
  STANDARD_DRUM_MIDI_NAMES,
  splitYargNoteId,
} from '../../../shared/midi/index';
import { sngDelayMs } from '../../../shared/sng/index';
import type { YargNote, YargNoteId } from '../../../shared/types/index';
import { ActionLog } from '../components/ActionLog';
import { AnchoredTooltip, anchorBottomRight } from '../components/AnchoredTooltip';
import { ChartCanvas } from '../components/ChartCanvas';
import { GemContextMenu, type ReassignScope } from '../components/GemContextMenu';
import { HelpIcon } from '../components/HelpIcon';
import { MinimapCanvas } from '../components/MinimapCanvas';
import { yargNoteLabel } from '../components/YargNoteSwatch';
import {
  nextBarStart,
  nextErrorTime,
  type PlacedNote,
  previousBarStart,
  previousErrorTime,
} from '../playback/geometry';
import { displayedNotes } from '../playback/overrides';
import { type MetronomeBeat, Scheduler } from '../playback/scheduler';
import { errorMarkers, warningMarkers } from '../playback/warningMarkers';
import { buildActionLog, type LoggedAction } from '../state/actionLog';
import { useSettingsStore } from '../state/settingsStore';
import { useChartErrors } from '../state/useChartErrors';
import { useWizardStore } from '../state/wizardStore';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? 'ogg' : filename.slice(dot + 1).toLowerCase();
}

// The source file's name without its directory or extension, for the transport title.
function baseNameOf(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  const dot = name.lastIndexOf('.');
  return dot === -1 ? name : name.slice(0, dot);
}

// Tooltip text for an error dot; lane names come from the renderer palette.
function describeError(error: ChartError): string {
  if (error.kind === 'threeHandNotes') {
    const lanes = error.notes.map((n) => yargNoteLabel(n).toLowerCase());
    return `${lanes.length} hand notes on one beat: ${lanes.join(', ')}`;
  }
  const [cymbal, tom] = error.notes;
  return `${yargNoteLabel(cymbal)} and ${yargNoteLabel(tom).toLowerCase()} on one beat`;
}

// The Preview step (docs/DESIGN.md → Chart preview + playback component): a left
// column with the 4-lane scrolling chart, a fit-to-height minimap beside it, and a
// right sidebar with the transport and timing controls. Left-click a gem to open a
// reassign/delete menu; right-click to delete it. Conversion issues are
// the dot gutter between the highway and the minimap — yellow warnings, red
// blocking errors. The metadata form and Save moved to the Finalize step; the
// footer Next advances Preview → Finalize.
export function PreviewView() {
  const score = useWizardStore((s) => s.score);
  const gpFilePath = useWizardStore((s) => s.gpFilePath);
  const selectedTrackId = useWizardStore((s) => s.selectedTrackId);
  const chart = useWizardStore((s) => s.chart);
  const warnings = useWizardStore((s) => s.warnings);
  const audioBuffer = useWizardStore((s) => s.audioBuffer);
  const audioOffsetMs = useWizardStore((s) => s.audioOffsetMs);
  const viewTime = useWizardStore((s) => s.viewTime);
  const pixelsPerSecond = useWizardStore((s) => s.pixelsPerSecond);
  const overrides = useWizardStore((s) => s.overrides);
  const deletions = useWizardStore((s) => s.deletions);
  const previewRemaps = useWizardStore((s) => s.previewRemaps);
  const removeOverride = useWizardStore((s) => s.removeOverride);
  const removeDeletion = useWizardStore((s) => s.removeDeletion);
  const recordPreviewRemap = useWizardStore((s) => s.recordPreviewRemap);
  const removePreviewRemap = useWizardStore((s) => s.removePreviewRemap);
  const sessionMap = useWizardStore((s) => s.sessionMap);
  const sessionSettings = useWizardStore((s) => s.sessionSettings);
  const setAudio = useWizardStore((s) => s.setAudio);
  const clearAudio = useWizardStore((s) => s.clearAudio);
  const setAudioOffsetMs = useWizardStore((s) => s.setAudioOffsetMs);
  const setViewTime = useWizardStore((s) => s.setViewTime);
  const setPixelsPerSecond = useWizardStore((s) => s.setPixelsPerSecond);
  const previewVolume = useWizardStore((s) => s.previewVolume);
  const setPreviewVolume = useWizardStore((s) => s.setPreviewVolume);
  const playbackRate = useWizardStore((s) => s.playbackRate);
  const metronomeOn = useWizardStore((s) => s.metronomeOn);
  const metronomeVolume = useWizardStore((s) => s.metronomeVolume);
  const setPlaybackRate = useWizardStore((s) => s.setPlaybackRate);
  const setMetronomeOn = useWizardStore((s) => s.setMetronomeOn);
  const setMetronomeVolume = useWizardStore((s) => s.setMetronomeVolume);
  const deleteNote = useWizardStore((s) => s.deleteNote);
  const addOverride = useWizardStore((s) => s.addOverride);
  const setConversion = useWizardStore((s) => s.setConversion);

  const globalMap = useSettingsStore((s) => s.globalMap);
  const setGlobalMap = useSettingsStore((s) => s.setGlobalMap);

  const schedulerRef = useRef<Scheduler | null>(null);
  if (schedulerRef.current === null) schedulerRef.current = new Scheduler();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [hover, setHover] = useState<{ midi: number; x: number; y: number } | null>(null);
  const [warnHover, setWarnHover] = useState<{
    messages: string[];
    x: number;
    y: number;
  } | null>(null);
  // The highway error underline's own hover tooltip — pinned to the middle of the line
  // (bottom-left corner) rather than the gutter dots' bottom-right, and prefixed "Error:".
  const [errorHover, setErrorHover] = useState<{
    messages: string[];
    x: number;
    y: number;
  } | null>(null);
  const [menu, setMenu] = useState<{ note: YargNote; x: number; y: number } | null>(null);
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptError, setPromptError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);

  // Dispose the AudioContext when leaving the step.
  useEffect(() => () => schedulerRef.current?.dispose(), []);

  const displayed = useMemo(
    () => (chart === null ? [] : displayedNotes(chart.notes, overrides, deletions)),
    [chart, overrides, deletions],
  );
  const placed = useMemo<PlacedNote[]>(
    () =>
      chart === null
        ? []
        : displayed.map((n) => ({
            note: n,
            seconds: tickToSeconds(n.tick, chart.tempoMap, chart.resolution),
          })),
    [displayed, chart],
  );
  const songEnd = useMemo(
    () => (chart === null ? 0 : tickToSeconds(chart.endTick, chart.tempoMap, chart.resolution)),
    [chart],
  );
  const barLines = useMemo<number[]>(
    () =>
      chart === null
        ? []
        : barStartTicks(chart.timeSignatures, chart.endTick, chart.resolution).map((t) =>
            tickToSeconds(t, chart.tempoMap, chart.resolution),
          ),
    [chart],
  );
  const divisionLines = useMemo<number[]>(
    () =>
      chart === null
        ? []
        : barDivisionTicks(chart.timeSignatures, chart.endTick, chart.resolution).map((t) =>
            tickToSeconds(t, chart.tempoMap, chart.resolution),
          ),
    [chart],
  );
  // The lead-in bar count read from the chart itself (single source of truth, so
  // it can't skew from the settings): the measure lines below leadInTicks.
  const leadInBars = useMemo<number>(
    () =>
      chart === null
        ? 0
        : barStartTicks(chart.timeSignatures, chart.endTick, chart.resolution).filter(
            (t) => t < chart.leadInTicks,
          ).length,
    [chart],
  );
  // GP document bar per measure line, index-aligned with barLines. The leading
  // lead-in entries are null (ChartCanvas shows "Lead-in" for those).
  const barNumbers = useMemo<(number | null)[]>(
    () =>
      chart === null || score === null
        ? []
        : playedBars(score.masterBars, chart.resolution, leadInBars).map((b) => b.gpBar),
    [chart, score, leadInBars],
  );
  // Song-bar start ticks only (lead-in bars excluded) for the action log. Notes
  // live only in song bars and their ticks are shifted by leadInTicks, so
  // playedBarOf yields the correct 1-based song bar.
  const barStarts = useMemo<number[]>(
    () =>
      chart === null || score === null
        ? []
        : playedBars(score.masterBars, chart.resolution, leadInBars)
            .filter((b) => b.gpBar !== null)
            .map((b) => b.tick),
    [chart, score, leadInBars],
  );
  const actions = useMemo(
    () => buildActionLog({ overrides, deletions, previewRemaps, barStarts }),
    [overrides, deletions, previewRemaps, barStarts],
  );
  const beats = useMemo<MetronomeBeat[]>(
    () =>
      chart === null
        ? []
        : beatEvents(chart.timeSignatures, chart.endTick, chart.resolution).map((b) => ({
            seconds: tickToSeconds(b.tick, chart.tempoMap, chart.resolution),
            accent: b.accent,
          })),
    [chart],
  );

  useEffect(() => {
    schedulerRef.current?.setBeats(beats);
  }, [beats]);

  // Keep the scheduler's buffer in sync with the store: adding, replacing, or
  // removing audio takes effect immediately (starting the source mid-playback), and
  // returning to this step re-arms the buffer without waiting for the next Play.
  useEffect(() => {
    schedulerRef.current?.setBuffer(audioBuffer);
  }, [audioBuffer]);

  // A remount creates a fresh Scheduler (defaults), but the store keeps these
  // view-only prefs — push them once on mount so playback honors the displayed
  // controls after navigating away and back.
  useEffect(() => {
    const s = schedulerRef.current;
    if (s === null) return;
    const state = useWizardStore.getState();
    s.setVolume(state.previewVolume);
    s.setRate(state.playbackRate);
    s.setMetronome(state.metronomeOn);
    s.setMetronomeVolume(state.metronomeVolume);
  }, []);

  const sectionMarks = useMemo(
    () =>
      chart === null
        ? []
        : chart.sections.map((sec) => ({
            name: sec.name,
            seconds: tickToSeconds(sec.tick, chart.tempoMap, chart.resolution),
          })),
    [chart],
  );

  const errors = useChartErrors();

  // Two dot layers in the gutter (docs spec → Preview errors vs. warnings): yellow
  // warnings from the conversion, and red errors recomputed live from the displayed
  // chart so a reassign clears them.
  const warningDots = useMemo(
    () =>
      chart === null
        ? []
        : warningMarkers(warnings, (tick) => tickToSeconds(tick, chart.tempoMap, chart.resolution)),
    [warnings, chart],
  );
  const errorDots = useMemo(
    () =>
      chart === null
        ? []
        : errorMarkers(
            errors,
            (tick) => tickToSeconds(tick, chart.tempoMap, chart.resolution),
            describeError,
          ),
    [errors, chart],
  );

  // The wizard only routes here after a successful conversion.
  if (chart === null || score === null || selectedTrackId === null) {
    return null;
  }
  // Non-null locals so the handler closures keep the narrowing (TS drops
  // control-flow narrowing of possibly-null store values across function bounds).
  const scheduler = schedulerRef.current;
  const gpScore = score;
  const gpChart = chart;
  const gpTrackId = selectedTrackId;

  function stopPlayback(at: number) {
    scheduler.stop();
    setIsPlaying(false);
    setViewTime(at);
  }

  function togglePlay() {
    if (isPlaying) {
      stopPlayback(scheduler.currentChartTime());
      return;
    }
    scheduler.play(viewTime, sngDelayMs(gpChart, audioOffsetMs) / 1000);
    setIsPlaying(true);
  }

  function handleScrub(delta: number) {
    const base = scheduler.isPlaying ? scheduler.currentChartTime() : viewTime;
    if (scheduler.isPlaying) {
      scheduler.stop();
      setIsPlaying(false);
    }
    setViewTime(clamp(base + delta, 0, songEnd));
  }

  function handleOffsetChange(ms: number) {
    setAudioOffsetMs(ms);
    if (scheduler.isPlaying) scheduler.reanchor(sngDelayMs(gpChart, ms) / 1000);
  }

  function seekTo(t: number) {
    const target = clamp(t, 0, songEnd);
    if (scheduler.isPlaying) scheduler.seek(target);
    else setViewTime(target);
  }

  // Bar-nav buttons under the highway: jump to the previous/next bar start relative
  // to where we are now (the live clock while playing, viewTime while stopped).
  function goPrevBar() {
    const now = scheduler.isPlaying ? scheduler.currentChartTime() : viewTime;
    seekTo(previousBarStart(barLines, now) ?? 0);
  }

  function goNextBar() {
    const now = scheduler.isPlaying ? scheduler.currentChartTime() : viewTime;
    seekTo(nextBarStart(barLines, now) ?? songEnd);
  }

  // Errors-section nav: jump to the nearest blocking-error tick before/after the
  // current position, wrapping around the song end (docs spec → Preview errors).
  function goPrevError() {
    const now = scheduler.isPlaying ? scheduler.currentChartTime() : viewTime;
    const times = errorDots.map((e) => e.seconds);
    const target = previousErrorTime(times, now);
    if (target !== null) seekTo(target);
  }

  function goNextError() {
    const now = scheduler.isPlaying ? scheduler.currentChartTime() : viewTime;
    const times = errorDots.map((e) => e.seconds);
    const target = nextErrorTime(times, now);
    if (target !== null) seekTo(target);
  }

  function handleVolumeChange(v: number) {
    setPreviewVolume(v);
    scheduler.setVolume(v);
  }

  function handleRateChange(r: number) {
    setPlaybackRate(r);
    scheduler.setRate(r);
  }

  function toggleMetronome() {
    const next = !metronomeOn;
    setMetronomeOn(next);
    scheduler.setMetronome(next);
  }

  function handleMetronomeVolumeChange(v: number) {
    setMetronomeVolume(v);
    scheduler.setMetronomeVolume(v);
  }

  async function handleAudioFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file later
    if (file === undefined) return;
    setAudioError(null);
    setAudioLoading(true);
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf.slice(0)); // keep source bytes; decode detaches buf
      const decoded = await scheduler.decode(buf);
      setAudio({ buffer: decoded, bytes, extension: extensionOf(file.name) });
    } catch {
      setAudioError('Could not decode that audio file. Pick a different file.');
    } finally {
      setAudioLoading(false);
    }
  }

  function handleActivate(note: YargNote | null, clientX: number, clientY: number) {
    setMenu(note === null ? null : { note, x: clientX, y: clientY });
  }

  function closeMenu() {
    setMenu(null);
  }

  // Right-click on a gem: a one-off delete of just that gem (an open menu, if any, closes
  // itself via its outside-click handler when the right-click lands on the canvas).
  function handleDelete(note: YargNote) {
    deleteNote({ tick: note.tick, midi: note.midi });
  }

  function handleReassign(target: YargNoteId | null, scope: ReassignScope) {
    if (menu === null) return;
    const { tick, midi } = menu.note;
    if (scope === 'one') {
      // Scope-"one" unassign is a one-off delete of this gem.
      if (target === null) {
        deleteNote({ tick, midi });
        return;
      }
      const { note, accented } = splitYargNoteId(target);
      addOverride({ tick, midi, note, accented });
      return;
    }
    // "All notes on MIDI n" (target may be null = unassign the MIDI entirely):
    // remap the session map, re-convert, record it for the Action Log, and offer the
    // same "Update global MIDI map?" prompt as the Mapping step (docs/INTRO.md §10).
    const currentMap = sessionMap ?? globalMap;
    const cur = lookup(currentMap, midi);
    const from: YargNoteId | null = cur ? (cur.accented ? `${cur.note}Accented` : cur.note) : null;
    const nextMap = applyRemap(currentMap, midi, target);
    try {
      const result = convertToYargChart(gpScore, gpTrackId, nextMap, sessionSettings);
      // Commit the map edit only after a successful re-convert (recordPreviewRemap
      // sets the session map); a failed reassign must not wipe the current chart.
      recordPreviewRemap({ midi, from, to: target, nextMap });
      setConversion(result.chart, result.warnings);
      setPromptOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reassign failed.');
    }
  }

  function handleUndo(a: LoggedAction) {
    if (a.kind === 'reassign') {
      removeOverride(a.tick, a.midi);
      return;
    }
    if (a.kind === 'delete') {
      removeDeletion(a.tick, a.midi);
      return;
    }
    undoGlobalRemap(a.midi); // globalReassign | globalUnassign
  }

  // Undo a Preview "all notes" remap: put the MIDI back to the row it held before
  // the first Preview remap, re-convert, and drop the entry. Reverts the session
  // effect only — a promoted global map is untouched.
  function undoGlobalRemap(midi: number) {
    const entry = previewRemaps.find((r) => r.midi === midi);
    if (entry === undefined) return;
    const revertMap = applyRemap(sessionMap ?? globalMap, midi, entry.from);
    try {
      const result = convertToYargChart(gpScore, gpTrackId, revertMap, sessionSettings);
      removePreviewRemap(midi, revertMap);
      setConversion(result.chart, result.warnings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Undo failed.');
    }
  }

  async function updateGlobalYes() {
    try {
      await setGlobalMap(sessionMap ?? globalMap);
      setPromptOpen(false);
      setPromptError(false);
    } catch {
      setPromptError(true); // in-memory session map retained
    }
  }

  return (
    <div className="preview">
      <div className="preview__main">
        <div className="preview__chart">
          <ChartCanvas
            placed={placed}
            barLines={barLines}
            divisionLines={divisionLines}
            errorLines={errorDots}
            barNumbers={barNumbers}
            leadInBars={leadInBars}
            viewTime={viewTime}
            isPlaying={isPlaying}
            pixelsPerSecond={pixelsPerSecond}
            songEnd={songEnd}
            selectedRef={menu === null ? null : { tick: menu.note.tick, midi: menu.note.midi }}
            getChartTime={() => scheduler.currentChartTime()}
            onScrub={handleScrub}
            onReachEnd={() => stopPlayback(songEnd)}
            onHover={(note, x, y) => setHover(note === null ? null : { midi: note.midi, x, y })}
            onErrorHover={(messages, x, y) =>
              setErrorHover(messages === null ? null : { messages, x, y })
            }
            onActivate={handleActivate}
            onDelete={handleDelete}
            sections={sectionMarks}
          />
          {hover !== null && (
            <AnchoredTooltip className="midi-tooltip" anchor={{ x: hover.x, y: hover.y }}>
              {STANDARD_DRUM_MIDI_NAMES[hover.midi]
                ? `${hover.midi} — ${STANDARD_DRUM_MIDI_NAMES[hover.midi]}`
                : String(hover.midi)}
            </AnchoredTooltip>
          )}
          {errorHover !== null && (
            <AnchoredTooltip
              className="midi-tooltip midi-tooltip--stack"
              anchor={{ x: errorHover.x, y: errorHover.y }}
              anchorCorner="bottom-left"
            >
              {errorHover.messages.map((msg) => (
                <div key={msg}>
                  <span className="tooltip-error-label">Error:</span> {msg}
                </div>
              ))}
            </AnchoredTooltip>
          )}
        </div>
        <div className="preview__barnav">
          <button type="button" className="btn" onClick={goPrevBar} aria-label="Previous bar">
            ◀
          </button>
          <button type="button" className="btn" onClick={goNextBar} aria-label="Next bar">
            ▶
          </button>
        </div>
      </div>

      <div className="preview__warnings">
        {warningDots.map((m) => (
          <button
            type="button"
            key={`w-${m.seconds}`}
            className="preview__dot preview__dot--warning"
            style={{ top: `${songEnd > 0 ? (1 - m.seconds / songEnd) * 100 : 0}%` }}
            aria-label={m.messages.join('; ')}
            onMouseEnter={(e) =>
              setWarnHover({ messages: m.messages, ...anchorBottomRight(e.currentTarget) })
            }
            onMouseLeave={() => setWarnHover(null)}
            onClick={() => seekTo(m.seconds)}
          />
        ))}
        {errorDots.map((m) => (
          <button
            type="button"
            key={`e-${m.seconds}`}
            className="preview__dot preview__dot--error"
            style={{ top: `${songEnd > 0 ? (1 - m.seconds / songEnd) * 100 : 0}%` }}
            aria-label={m.messages.join('; ')}
            onMouseEnter={(e) =>
              setWarnHover({ messages: m.messages, ...anchorBottomRight(e.currentTarget) })
            }
            onMouseLeave={() => setWarnHover(null)}
            onClick={() => seekTo(m.seconds)}
          />
        ))}
        {warnHover !== null && (
          <AnchoredTooltip
            className="midi-tooltip midi-tooltip--stack"
            anchor={{ x: warnHover.x, y: warnHover.y }}
          >
            {warnHover.messages.map((msg) => (
              <div key={msg}>{msg}</div>
            ))}
          </AnchoredTooltip>
        )}
      </div>

      <div className="preview__minimap">
        <MinimapCanvas
          placed={placed}
          songEnd={songEnd}
          viewTime={viewTime}
          isPlaying={isPlaying}
          getChartTime={() => scheduler.currentChartTime()}
          onSeek={seekTo}
        />
        {sectionMarks.map((sec) => (
          <div
            key={`${sec.name}-${sec.seconds}`}
            className="minimap__label"
            style={{ top: `${songEnd > 0 ? (1 - sec.seconds / songEnd) * 100 : 0}%` }}
          >
            {sec.name}
          </div>
        ))}
      </div>

      <aside className="preview__sidebar">
        <section className="transport">
          {gpFilePath !== null && (
            <div className="transport__filename">{baseNameOf(gpFilePath)}</div>
          )}
          <div className="transport__buttons">
            <button type="button" className="btn btn--primary" onClick={togglePlay}>
              {isPlaying ? '■ Stop' : '▶ Play'}
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => seekTo(0)}
              disabled={!isPlaying && viewTime <= 0}
            >
              ⟲ Restart
            </button>
          </div>

          <div className="transport__audio">
            <button
              type="button"
              className="btn"
              disabled={audioLoading}
              onClick={() => fileInputRef.current?.click()}
            >
              {audioBuffer === null ? 'Add Audio' : 'Replace Audio'}
            </button>
            {audioBuffer !== null && (
              <button
                type="button"
                className="btn btn--destructive"
                onClick={() => {
                  if (isPlaying) stopPlayback(scheduler.currentChartTime());
                  clearAudio();
                }}
              >
                Remove Audio
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".mp3,.ogg,.opus,.wav,audio/*"
              hidden
              onChange={handleAudioFile}
            />
          </div>
          {audioBuffer === null && audioLoading && (
            <p className="transport__note transport__note--loading">Loading audio…</p>
          )}
          {audioBuffer === null && !audioLoading && (
            <p className="transport__note transport__note--warning">
              You must add audio to play this song in YARG. To use Guitar Pro audio, go to File &gt;
              Export &gt; Audio in Guitar Pro (.ogg preferred).
            </p>
          )}
          {audioError !== null && (
            <div className="error-banner error-banner--inline">{audioError}</div>
          )}

          {audioBuffer !== null && (
            <label className="transport__field">
              <span>Audio preview volume ({Math.round(previewVolume * 100)}%)</span>
              <input
                type="range"
                min={0}
                max={200}
                step={5}
                value={Math.round(previewVolume * 100)}
                onChange={(e) => handleVolumeChange(Number(e.target.value) / 100)}
              />
            </label>
          )}
        </section>

        <section className="transport">
          <div className="settings-label">Timing</div>

          <label className="transport__field transport__field--inline">
            <span>
              Audio offset (ms){' '}
              <HelpIcon text="Offset the audio to sync with the chart as needed. It is recommended to use the metronome as a guide rather than the visuals. This will affect the output .sng file" />
            </span>
            <input
              className="text-input"
              type="number"
              step={1}
              value={String(audioOffsetMs)}
              onChange={(e) => handleOffsetChange(Math.round(Number(e.target.value) || 0))}
            />
          </label>

          <label className="transport__field">
            <span>
              Highway speed ({pixelsPerSecond} px/s){' '}
              <HelpIcon text="Affects preview playback only; does not affect the output .sng file" />
            </span>
            <input
              type="range"
              min={400}
              max={1000}
              step={25}
              value={pixelsPerSecond}
              onChange={(e) => setPixelsPerSecond(Number(e.target.value))}
            />
          </label>

          <label className="transport__field">
            <span>
              Playback speed ({Math.round(playbackRate * 100)}%){' '}
              <HelpIcon text="Affects preview playback only; does not affect the output .sng file" />
            </span>
            <input
              type="range"
              min={0}
              max={200}
              step={5}
              value={Math.round(playbackRate * 100)}
              onChange={(e) => handleRateChange(Number(e.target.value) / 100)}
            />
          </label>

          <button
            type="button"
            className={metronomeOn ? 'btn btn--primary' : 'btn'}
            onClick={toggleMetronome}
          >
            {metronomeOn ? 'Metronome: On' : 'Metronome: Off'}
          </button>

          <p className="transport__note">
            Adjust the audio offset until the song audio is synced with the metronome.
          </p>

          <label className="transport__field">
            <span>Metronome volume ({Math.round(metronomeVolume * 100)}%)</span>
            <input
              type="range"
              min={0}
              max={200}
              step={5}
              value={Math.round(metronomeVolume * 100)}
              onChange={(e) => handleMetronomeVolumeChange(Number(e.target.value) / 100)}
            />
          </label>
        </section>

        {errors.length > 0 && (
          <section className="transport">
            <div className="settings-label settings-label--error">Errors</div>
            <p className="transport__note">
              {errors.length} chart {errors.length === 1 ? 'error' : 'errors'} remaining. Use the
              below buttons to navigate
            </p>
            <div className="preview__barnav">
              <button
                type="button"
                className="btn"
                onClick={goPrevError}
                aria-label="Previous error"
              >
                ◀
              </button>
              <button type="button" className="btn" onClick={goNextError} aria-label="Next error">
                ▶
              </button>
            </div>
          </section>
        )}

        <ActionLog actions={actions} onUndo={handleUndo} />

        {error !== null && <div className="error-banner error-banner--inline">{error}</div>}
      </aside>

      {menu !== null && (
        <GemContextMenu
          note={menu.note}
          x={menu.x}
          y={menu.y}
          onReassign={handleReassign}
          onClose={closeMenu}
        />
      )}

      {promptOpen && (
        <div className="modal-scrim">
          <div className="modal">
            <div className="modal__title">Update global MIDI map?</div>
            <p className="modal__body">
              You reassigned all notes on a MIDI number. Apply this to the global MIDI map for
              future conversions too?
            </p>
            {promptError && (
              <div className="error-banner error-banner--inline">
                Could not save the global map. Try again, or keep the change for this song only.
              </div>
            )}
            <div className="modal__actions">
              <button type="button" className="btn" onClick={updateGlobalYes}>
                Yes, update global map
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={() => {
                  setPromptOpen(false);
                  setPromptError(false);
                }}
              >
                No, this song only
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
