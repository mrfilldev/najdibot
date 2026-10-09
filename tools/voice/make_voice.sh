#!/bin/sh
# Рецепт «холодного надрывного» мужского голоса (вариант №3, 210 Гц).
# Использование: ./make_voice.sh text.txt out.mp3
# Нужны: ffmpeg, python с torch, praat-parselmouth, numpy; модель v4_ru.pt рядом (models.silero.ai/models/tts/ru/v4_ru.pt).
set -e
T="$1"; OUT="$2"; D=$(mktemp -d); cp "$T" "$D/text.txt"; cp "$(dirname "$0")"/../../models/v4_ru.pt "$D/" 2>/dev/null || true
# 1. озвучка Silero, голос aidar (читает мат как написано)
python "$(dirname "$0")/silero_tts.py" "$D"            # даст $D/sil_aidar.wav (и остальные голоса)
# 2. поднять высоту до ~210 Гц, тембр мужской (форманты 1.0), интонация сохраняется
python "$(dirname "$0")/shift.py" "$D/sil_aidar.wav" "$D/hi.wav" 210
# 3. темп x1.3
ffmpeg -y -loglevel error -i "$D/hi.wav" -af atempo=1.3 "$D/fast.wav"
# 4. холодный тембр: эквалайзер по кривой из docs/voice-recipe.md, три слоя, умеренный перегруз
EQ="entry(20,-3.4);entry(80,-3.4);entry(100,-8.4);entry(125,-12.0);entry(160,-1.8);entry(200,-12.0);entry(250,-4.0);entry(315,4.9);entry(400,-7.2);entry(500,-3.1);entry(630,2.4);entry(800,0.4);entry(1000,1.6);entry(1250,8.2);entry(1600,1.8);entry(2000,6.5);entry(2500,12.0);entry(3150,8.9);entry(4000,5.1);entry(5000,3.2);entry(6300,4.7);entry(8000,-0.2);entry(11000,-0.2)"
ffmpeg -y -loglevel error -i "$D/fast.wav" -filter_complex "[0:a]aresample=22050,silenceremove=stop_periods=-1:stop_duration=0.12:stop_threshold=-38dB,highpass=f=80,firequalizer=gain_entry='$EQ',equalizer=f=220:t=q:w=1:g=4,equalizer=f=450:t=q:w=1:g=2,equalizer=f=2800:t=q:w=1.2:g=2[x];[x]asplit=3[a][b][c];[b]asetrate=17511,aresample=22050,atempo=1.2599[l1];[c]asetrate=14700,aresample=22050,atempo=1.5[l2];[a][l1][l2]amix=inputs=3:weights='1 0.45 0.25':normalize=0:duration=first[m];[m]volume=1.6,asoftclip=type=tanh,acrusher=bits=12:mode=log:mix=0.1,acompressor=threshold=-18dB:ratio=4,loudnorm=I=-16" -ar 22050 "$D/o.wav"
ffmpeg -y -loglevel error -i "$D/o.wav" -c:a libmp3lame -b:a 128k "$OUT"
rm -rf "$D"
