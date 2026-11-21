"""Create a portable source archive, excluding hosting identity and Git metadata."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
output = root / 'dist' / 'rainfall-atlas-source.zip'
with ZipFile(output, 'w', compression=ZIP_DEFLATED) as archive:
    for folder in ('dist', 'tools', 'tests', '.github'):
        for path in sorted((root / folder).rglob('*')):
            if path.is_file() and path.suffix != '.zip' and '__pycache__' not in path.parts:
                archive.write(path, Path('rainfall-atlas') / path.relative_to(root))
    for name in ('README.md', 'LICENSE', 'package.json', '.gitignore'):
        archive.write(root / name, Path('rainfall-atlas') / name)
print(output)
