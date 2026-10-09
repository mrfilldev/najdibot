import torch, sys, wave, numpy as np
from torch.package import PackageImporter
S = sys.argv[1]
imp = PackageImporter(S + '/v4_ru.pt')
model = imp.load_pickle("tts_models", "model"); model.to('cpu')
text = open(S + '/text.txt').read().strip()
for spk in ('aidar', 'eugene', 'xenia', 'kseniya'):
    audio = model.apply_tts(text=text, speaker=spk, sample_rate=24000, put_accent=True, put_yo=True)
    pcm = (audio.numpy().clip(-1, 1) * 32767).astype(np.int16)
    with wave.open(f'{S}/sil_{spk}.wav', 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(24000); w.writeframes(pcm.tobytes())
    print(spk, len(pcm) / 24000, 's')
