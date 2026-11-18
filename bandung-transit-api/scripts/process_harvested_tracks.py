import json
import networkx as nx
import math

print("Loading osm_harvest.json...")
with open("osm_harvest.json", "r") as f:
    data = json.load(f)

node_coords = data["node_coords"]
edges = data["edges"]

print(f"Loaded {len(node_coords)} nodes and {len(edges)} edges.")

G = nx.Graph()

for u, v in edges:
    if u in node_coords and v in node_coords:
        p1 = node_coords[u]
        p2 = node_coords[v]
        dist = math.hypot(p2[0] - p1[0], p2[1] - p1[1])
        # Add edge with weight = dist
        G.add_edge(u, v, weight=dist)

# If there are tiny gaps between adjacent harvested tiles (< 100 meters / ~0.001 deg), connect the closest nodes
comps = list(nx.connected_components(G))
print(f"Initial connected components: {len(comps)}")

while len(comps) > 1:
    # Find two closest nodes belonging to different components
    min_d = 999
    best_pair = None
    for i in range(len(comps)):
        for j in range(i + 1, len(comps)):
            # Check bounding boxes first
            for u in comps[i]:
                pu = node_coords[u]
                for v in comps[j]:
                    pv = node_coords[v]
                    if abs(pu[0] - pv[0]) < 0.003 and abs(pu[1] - pv[1]) < 0.003:
                        d = math.hypot(pu[0] - pv[0], pu[1] - pv[1])
                        if d < min_d:
                            min_d = d
                            best_pair = (u, v)
    if best_pair and min_d < 0.003: # less than ~300 meters
        print(f"Connecting component gap of {min_d * 111000:.1f}m between {best_pair[0]} and {best_pair[1]}")
        G.add_edge(best_pair[0], best_pair[1], weight=min_d)
        comps = list(nx.connected_components(G))
    else:
        break

print(f"Remaining components: {len(comps)}")

# The 13 Station Coordinates:
stations = [
    ("Padalarang", 107.495979, -6.841603),
    ("Gadobangkong", 107.514957, -6.864073),
    ("Cimahi", 107.537071, -6.886886),
    ("Cimindi", 107.560842, -6.895870),
    ("Ciroyom", 107.590147, -6.913994),
    ("Bandung", 107.601705, -6.914280),
    ("Cikudapateuh", 107.625403, -6.918598),
    ("Kiaracondong", 107.645615, -6.924760),
    ("Gedebage", 107.690510, -6.941084),
    ("Cimekar", 107.712130, -6.948964),
    ("Rancaekek", 107.755848, -6.964820),
    ("Haurpugur", 107.799052, -6.980494),
    ("Cicalengka", 107.832059, -6.980729),
]

def find_closest_in_graph(target_lon, target_lat):
    best_n = None
    min_dist = 999
    for n in G.nodes:
        lon, lat = node_coords[n]
        d = math.hypot(lon - target_lon, lat - target_lat)
        if d < min_dist:
            min_dist = d
            best_n = n
    return best_n, min_dist

station_nodes = []
for name, slon, slat in stations:
    nid, d = find_closest_in_graph(slon, slat)
    print(f"Station {name}: node {nid} at {node_coords[nid]} (offset {d*111000:.1f}m)")
    station_nodes.append((name, nid))

# Now construct the path station-by-station
full_path_coords = []

for i in range(len(station_nodes) - 1):
    st_from, n_from = station_nodes[i]
    st_to, n_to = station_nodes[i+1]
    try:
        sub_path = nx.shortest_path(G, source=n_from, target=n_to, weight='weight')
        print(f"Segment {st_from} -> {st_to}: {len(sub_path)} points")
        for idx_p, nid in enumerate(sub_path):
            if i > 0 and idx_p == 0:
                continue # avoid duplicate junction point
            pt = node_coords[nid]
            full_path_coords.append([round(pt[0], 6), round(pt[1], 6)])
    except Exception as e:
        print(f"Error finding path {st_from} -> {st_to}:", e)

print(f"\nTOTAL FULL TRACK COORD COUNT: {len(full_path_coords)}")

# Save to json file
with open("true_railway_track.json", "w") as f:
    json.dump(full_path_coords, f)
print("Saved true_railway_track.json!")
