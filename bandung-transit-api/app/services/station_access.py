"""
Verified active pedestrian entrance gates & hall connectors for all 13 Commuter Line Bandung Raya stations.

Why this exists:
A railway station's `stops.geom` sits on the physical railway track so train polylines
align accurately on the rails. However, routing a pedestrian directly to a railway track
coordinate causes street routers (OSRM/Valhalla) to snap to whichever road is closest
across the railway fence — often sending commuters to closed/non-existent sides
(e.g., Griya Utama north side at Stasiun Rancaekek instead of the active Rancaekek Kencana
south side, or Jalan Industri locomotive depot north of Stasiun Ciroyom).

Each station lists ONLY its real-world active pedestrian entrance(s) on the public street network.
When a station has multiple active entrances (e.g., Stasiun Bandung Utara & Selatan),
the pedestrian router evaluates each entrance and automatically selects the shortest walk.
"""

from typing import TypedDict


class StationEntrance(TypedDict):
    gate: list[float]       # [lng, lat] on the public street/plaza network
    hall: list[float]       # [lng, lat] station main door / ticket hall
    label: str              # Human-readable entrance label


STATION_ENTRANCES: dict[str, list[StationEntrance]] = {
    "Stasiun Padalarang": [
        {
            "gate": [107.497183, -6.843274],
            "hall": [107.497221, -6.843097],
            "label": "Pintu Utama KAI Padalarang",
        },
        {
            "gate": [107.496612, -6.842864],
            "hall": [107.496618, -6.842387],
            "label": "Pintu Skybridge / KCIC Padalarang",
        },
    ],
    "Stasiun Gadobangkong": [
        {
            "gate": [107.515200, -6.864750],
            "hall": [107.515129, -6.864564],
            "label": "Pintu Utama Stasiun Gadobangkong",
        },
    ],
    "Stasiun Cimahi": [
        {
            "gate": [107.536320, -6.885680],
            "hall": [107.536247, -6.885649],
            "label": "Pintu Timur - Jl. Stasiun Cimahi",
        },
        {
            "gate": [107.535720, -6.886100],
            "hall": [107.535784, -6.886033],
            "label": "Pintu Barat Stasiun Cimahi",
        },
    ],
    "Stasiun Cimindi": [
        {
            "gate": [107.561043, -6.896250],
            "hall": [107.561043, -6.896189],
            "label": "Pintu Utama - Jl. Mahar Martanegara",
        },
    ],
    "Stasiun Ciroyom": [
        # Active passenger entrance is strictly on the South side (Jl. Ciroyom / Gang Minyak Tanah).
        # North side (Jl. Industri) is fenced off.
        {
            "gate": [107.590283, -6.914220],
            "hall": [107.590283, -6.914134],
            "label": "Pintu Selatan Stasiun Ciroyom",
        },
    ],
    "Stasiun Bandung": [
        {
            "gate": [107.602521, -6.913450],
            "hall": [107.602521, -6.913547],
            "label": "Pintu Utara - Jl. Kebon Kawung",
        },
        {
            "gate": [107.602454, -6.914780],
            "hall": [107.602454, -6.914728],
            "label": "Pintu Selatan - Jl. Stasiun Timur",
        },
    ],
    "Stasiun Cikudapateuh": [
        {
            "gate": [107.625823, -6.918920],
            "hall": [107.625823, -6.918869],
            "label": "Pintu Utama Stasiun Cikudapateuh",
        },
    ],
    "Stasiun Kiaracondong": [
        {
            "gate": [107.645990, -6.924250],
            "hall": [107.645990, -6.924375],
            "label": "Pintu Utara - Jl. Babakan Sari",
        },
        {
            "gate": [107.646809, -6.925450],
            "hall": [107.646809, -6.925387],
            "label": "Pintu Selatan - Jl. Stasiun Kiaracondong",
        },
    ],
    "Stasiun Gedebage": [
        {
            "gate": [107.690199, -6.941220],
            "hall": [107.690199, -6.941147],
            "label": "Pintu Utama - Jl. Gedebage Selatan",
        },
    ],
    "Stasiun Cimekar": [
        {
            "gate": [107.712425, -6.949220],
            "hall": [107.712425, -6.949145],
            "label": "Pintu Utama Stasiun Cimekar Baru",
        },
    ],
    "Stasiun Rancaekek": [
        # Active passenger entrance is strictly on the South / Perumahan Rancaekek Kencana side.
        # The old Griya Utama (North) side entrance no longer exists.
        {
            "gate": [107.755722, -6.965454],
            "hall": [107.755853, -6.965071],
            "label": "Pintu Utama - Sisi Rancaekek Kencana",
        },
    ],
    "Stasiun Haurpugur": [
        {
            "gate": [107.799350, -6.980493],
            "hall": [107.799258, -6.980493],
            "label": "Pintu Utama Stasiun Haurpugur",
        },
    ],
    "Stasiun Cicalengka": [
        {
            "gate": [107.832750, -6.981350],
            "hall": [107.832689, -6.981318],
            "label": "Pintu Utama - Jl. Stasiun Cicalengka",
        },
    ],
}


def get_station_entrances(stop_name: str | None) -> list[StationEntrance]:
    """Returns active pedestrian entrances for a station stop, or empty list for regular bus shelters."""
    if not stop_name:
        return []
    return STATION_ENTRANCES.get(stop_name.strip(), [])
