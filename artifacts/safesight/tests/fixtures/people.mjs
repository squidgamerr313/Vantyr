export function person(x, { y = .45, angle = 0, visibility = .95, length = .2, id = `det-${x}` } = {}) {
  return { x, y, angle, visibility, length, id };
}
export function peopleFrame(people, { width = 1000, height = 600, time, poseOrder, noPose = [] } = {}) {
  const aspect = width / height;
  const detections = people.map((p) => ({
    id: p.id, label: 'person', confidence: .9,
    box: [(p.x - .13) * width, (p.y - .25) * height, .26 * width, .5 * height],
  }));
  const poses = people.map((p) => {
    const points = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }));
    const rad = p.angle * Math.PI / 180;
    const dx = Math.sin(rad) * p.length / (2 * aspect), dy = Math.cos(rad) * p.length / 2;
    for (const [i, side] of [[11, -1], [12, 1]]) points[i] = { x: p.x - dx + side * .012, y: p.y - dy, visibility: p.visibility };
    for (const [i, side] of [[23, -1], [24, 1]]) points[i] = { x: p.x + dx + side * .012, y: p.y + dy, visibility: p.visibility };
    return points;
  });
  return {
    detections,
    landmarks: (poseOrder ?? people.map((_, i) => i)).filter((i) => !noPose.includes(i)).map((i) => poses[i]),
    latency: 7,
    ...(time === undefined ? {} : { frameTimeMs: time }),
  };
}
