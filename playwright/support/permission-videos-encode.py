#!/usr/bin/env python3
"""Encode the permission videos recorded by playwright/e2e/app/permission-videos.capture.spec.ts.

Usage: python3 permission-videos-encode.py <playwright-results-dir> <output-dir> [--side-by-side A,B]

Each test of the spec leaves, in its output folder, one recording per browser window
(window-<n>-<person>.webm, Playwright's VP8 at 25 fps) and timeline.json (when each window opened
and closed, and when each caption was shown). For every test this script:

1. finds where each window's first caption appears in its recording (the caption banner's dark
   background at a fixed spot), which ties the recording's clock to the timeline's;
2. shows at each moment the window on screen in the story: the most recently opened window that is
   still open. Each part starts at the next caption shown in its window, so page loading (and, when
   the story comes back to a window, the moment before its next caption) is left out; so is the
   time after the last window closed (Playwright pads the end of a recording);
3. joins those parts in order (no other cut, no change of speed or content) into a lossless
   intermediate, then encodes <slug>.mp4 (libx264, crf 28, preset slow, yuv420p, faststart,
   width 1280) and <slug>.gif (8 fps, width 960, palettegen stats_mode=diff, paletteuse
   dither=bayer:bayer_scale=5). A GIF over 5 MB is made at 6 fps, and if it is still over 5 MB it
   is sped up uniformly (the factor is printed and must be stated in its caption).

<slug> is the test title up to its first colon. With --side-by-side A,B the joined videos of tests
A and B are also put side by side (B padded with its last frame if shorter) as <A>-and-<B>.mp4/.gif.
Prints a JSON summary: parts, durations, sizes and sha256 of every file written.
"""
import hashlib
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile

FPS = 25
CAPTION_LEAD = 0.25  # seconds after a caption's timestamp, so its first frame shows it
GIF_LIMIT = 5 * 1024 * 1024
MP4_LIMIT = 3 * 1024 * 1024
FFMPEG = shutil.which('ffmpeg')
FFPROBE = shutil.which('ffprobe')


def run(args):
    subprocess.run(args, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def duration(path):
    out = subprocess.run(
        [FFPROBE, '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', str(path)],
        check=True, capture_output=True, text=True,
    ).stdout.strip()
    return float(out)


def sha256(path):
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()


def banner_frames(webm):
    """Per frame: is the caption banner's background (dark navy) at the top centre?"""
    # 16x4 pixels inside the banner's top padding (it is centred at top: 8px, above its text).
    raw = subprocess.run(
        [FFMPEG, '-v', 'error', '-i', str(webm), '-vf', 'crop=16:4:632:11,scale=1:1:flags=area',
         '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
        check=True, capture_output=True,
    ).stdout
    marks = []
    for i in range(0, len(raw) - 2, 3):
        r, g, b = raw[i], raw[i + 1], raw[i + 2]
        marks.append(r < 70 and g < 78 and b < 100 and b - r > 12)
    return marks


def window_offset(webm, opened_ms, first_caption_ms):
    """Seconds of recording before the page's creation time (negative if it started later)."""
    marks = banner_frames(webm)
    expected = (first_caption_ms - opened_ms) / 1000
    # The banner first appears with the window's first caption and stays: its onset is the first
    # frame that starts five frames in a row with the banner.
    run = 5
    frame = next((i for i in range(len(marks) - run) if all(marks[i:i + run])), None)
    if frame is None:
        raise SystemExit(f'{webm}: no caption banner found')
    return frame / FPS - expected


def parts_for(timeline, folder):
    windows = timeline['windows']
    captions = {}  # window -> times of its captions, in order
    for event in timeline['events']:
        if event['kind'] == 'caption':
            captions.setdefault(event['window'], []).append(event['at_ms'])
    bounds = sorted({w['opened_ms'] for w in windows} | {w['closed_ms'] for w in windows})
    schedule = []  # (window, start_ms, end_ms) in timeline time
    for start, end in zip(bounds, bounds[1:]):
        open_now = [w for w in windows if w['opened_ms'] <= start < w['closed_ms']]
        if not open_now:
            continue
        active = max(open_now, key=lambda w: w['opened_ms'])
        if schedule and schedule[-1][0] is active and schedule[-1][2] == start:
            schedule[-1] = (active, schedule[-1][1], end)
        else:
            schedule.append((active, start, end))
    parts = []
    offsets = {}
    for window, start, end in schedule:
        times = captions.get(window['index'], [])
        upcoming = [at for at in times if start <= at < end]
        if not upcoming or upcoming[0] + CAPTION_LEAD * 1000 >= end:
            # Nothing was captioned while this window was on screen (e.g. a window still loading
            # when the next opened): reported, so a story is never cut silently.
            parts.append({'window': window['index'], 'person': window['person'], 'skipped': True,
                          'timeline_from_ms': int(start), 'timeline_to_ms': int(end)})
            continue
        start = upcoming[0] + CAPTION_LEAD * 1000
        webm = folder / window['file']
        if window['index'] not in offsets:
            offsets[window['index']] = window_offset(webm, window['opened_ms'], times[0])
        offset = offsets[window['index']]
        parts.append({
            'window': window['index'],
            'person': window['person'],
            'file': window['file'],
            'from_s': round((start - window['opened_ms']) / 1000 + offset, 3),
            'to_s': round(min((end - window['opened_ms']) / 1000 + offset, duration(webm)), 3),
            'timeline_from_ms': int(start),
            'timeline_to_ms': int(end),
        })
    return parts, offsets


def join(parts, folder, out):
    parts = [part for part in parts if not part.get('skipped')]
    inputs = []
    index_of = {}
    for part in parts:
        if part['file'] not in index_of:
            index_of[part['file']] = len(inputs)
            inputs.append(part['file'])
    uses = {}
    for part in parts:
        uses[part['file']] = uses.get(part['file'], 0) + 1
    graph = []
    taken = {}
    labels = []
    for name, count in uses.items():
        i = index_of[name]
        graph.append(f'[{i}:v]split={count}' + ''.join(f'[s{i}_{k}]' for k in range(count)) if count > 1
                     else f'[{i}:v]null[s{i}_0]')
    for n, part in enumerate(parts):
        i = index_of[part['file']]
        k = taken.get(i, 0)
        taken[i] = k + 1
        graph.append(f"[s{i}_{k}]trim=start={part['from_s']}:end={part['to_s']},setpts=PTS-STARTPTS[p{n}]")
        labels.append(f'[p{n}]')
    graph.append(''.join(labels) + f'concat=n={len(parts)}:v=1:a=0,fps={FPS}[out]')
    args = [FFMPEG, '-y', '-v', 'error']
    for name in inputs:
        args += ['-i', str(folder / name)]
    args += ['-filter_complex', ';'.join(graph), '-map', '[out]', '-c:v', 'libx264', '-crf', '0',
             '-preset', 'ultrafast', '-pix_fmt', 'yuv444p', str(out)]
    run(args)


def encode_mp4(source, out):
    run([FFMPEG, '-y', '-v', 'error', '-i', str(source), '-vf', 'scale=1280:-2:flags=lanczos', '-an',
         '-c:v', 'libx264', '-crf', '28', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
         str(out)])


def encode_gif(source, out):
    """8 fps; over 5 MB: 6 fps; still over: a uniform speed-up. Returns (fps, speed-up)."""
    for fps, speed in [(8, 1.0), (6, 1.0), (6, 1.25), (6, 1.5), (6, 1.75), (6, 2.0)]:
        speedup = f'setpts=PTS/{speed},' if speed != 1.0 else ''
        graph = (f'{speedup}fps={fps},scale=960:-1:flags=lanczos,split[a][b];'
                 '[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5')
        run([FFMPEG, '-y', '-v', 'error', '-i', str(source), '-filter_complex', graph, str(out)])
        if out.stat().st_size <= GIF_LIMIT:
            return fps, speed
    raise SystemExit(f'{out}: still over 5 MB at 2x')


def describe(path):
    return {'file': path.name, 'bytes': path.stat().st_size, 'sha256': sha256(path),
            'duration_s': round(duration(path), 2)}


def main():
    args = sys.argv[1:]
    side = None
    if '--side-by-side' in args:
        at = args.index('--side-by-side')
        side = args[at + 1].split(',')
        del args[at:at + 2]
    results, output = pathlib.Path(args[0]), pathlib.Path(args[1])
    output.mkdir(parents=True, exist_ok=True)
    summary = {}
    with tempfile.TemporaryDirectory() as scratch:
        joined = {}
        for timeline_path in sorted(results.rglob('timeline.json')):
            timeline = json.loads(timeline_path.read_text())
            if timeline.get('status') != 'passed':
                raise SystemExit(f'{timeline_path}: the test did not pass ({timeline.get("status")})')
            slug = timeline['test'].split(':', 1)[0].strip()
            parts, offsets = parts_for(timeline, timeline_path.parent)
            intermediate = pathlib.Path(scratch) / f'{slug}.mkv'
            join(parts, timeline_path.parent, intermediate)
            joined[slug] = intermediate
            mp4, gif = output / f'{slug}.mp4', output / f'{slug}.gif'
            encode_mp4(intermediate, mp4)
            fps, speed = encode_gif(intermediate, gif)
            summary[slug] = {
                'test': timeline['test'],
                'timeline': str(timeline_path),
                'recordings': {w['file']: sha256(timeline_path.parent / w['file']) for w in timeline['windows']},
                'recording_offsets_s': {str(k): round(v, 3) for k, v in offsets.items()},
                'parts': parts,
                'checks': [e['text'] for e in timeline['events'] if e['kind'] == 'check'],
                'captions': [e['text'] for e in timeline['events'] if e['kind'] == 'caption'],
                'mp4': describe(mp4),
                'gif': {**describe(gif), 'fps': fps, 'speedup': speed},
                'mp4_within_3mb': mp4.stat().st_size <= MP4_LIMIT,
            }
        if side:
            a, b = side
            name = f'{a}-and-{b}'
            stacked = pathlib.Path(scratch) / f'{name}.mkv'
            longest = max(duration(joined[a]), duration(joined[b]))
            graph = (f'[0:v]tpad=stop_mode=clone:stop_duration={longest}[l];'
                     f'[1:v]tpad=stop_mode=clone:stop_duration={longest}[r];'
                     f'[l][r]hstack=inputs=2,trim=duration={longest}[out]')
            run([FFMPEG, '-y', '-v', 'error', '-i', str(joined[a]), '-i', str(joined[b]), '-filter_complex', graph,
                 '-map', '[out]', '-c:v', 'libx264', '-crf', '0', '-preset', 'ultrafast', '-pix_fmt', 'yuv444p',
                 str(stacked)])
            mp4, gif = output / f'{name}.mp4', output / f'{name}.gif'
            encode_mp4(stacked, mp4)
            fps, speed = encode_gif(stacked, gif)
            summary[name] = {'mp4': describe(mp4), 'gif': {**describe(gif), 'fps': fps, 'speedup': speed},
                             'mp4_within_3mb': mp4.stat().st_size <= MP4_LIMIT}
    print(json.dumps(summary, indent=2))


if __name__ == '__main__':
    main()
