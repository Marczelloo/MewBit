# Instrument separation sits in its own venv, because Demucs and the analysis stack need different numpy versions.
FROM mewbeat-ma
RUN python3 -m venv /opt/sep \
 && /opt/sep/bin/pip install --no-cache-dir torch==2.5.1 torchaudio==2.5.1 --index-url https://download.pytorch.org/whl/cu121 \
 && /opt/sep/bin/pip install --no-cache-dir demucs==4.0.1 soundfile==0.12.1 \
 && /opt/sep/bin/python -c "from demucs.pretrained import get_model; get_model('htdemucs_6s')"
