import { useEffect, useRef, useState } from 'react';
import { Disc3 } from 'lucide-react';
export default function Disc({ image, playing, speed, reduced, title }: { image?: string; playing: boolean; speed: number; reduced: boolean; title: string }) {
  const rotor = useRef<HTMLDivElement>(null);
  const angle = useRef(0);
  const velocity = useRef(0);
  const target = useRef(0);
  const [failed, setFailed] = useState(false);
  const [previous, setPrevious] = useState<string>();
  const last = useRef(image);
  useEffect(() => {
    setFailed(false);
    if (last.current !== image) { setPrevious(last.current); last.current = image; const timer = setTimeout(() => setPrevious(undefined), 850); return () => clearTimeout(timer); }
  }, [image]);
  useEffect(() => { target.current = playing && !reduced ? 360 / 24 * speed : 0; }, [playing, speed, reduced]);
  useEffect(() => {
    let frame = 0;
    let lastTime = 0;
    const tick = (time: number) => {
      const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.05) : 0;
      lastTime = time;
      velocity.current += (target.current - velocity.current) * (1 - Math.exp(-dt * 1.7));
      if (Math.abs(velocity.current) < 0.015 && target.current === 0) velocity.current = 0;
      angle.current = (angle.current + velocity.current * dt) % 360;
      if (rotor.current) rotor.current.style.transform = `rotate(${angle.current}deg)`;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  return <div className="disc-cradle"><div className="disc-shadow"/><div className="disc" ref={rotor}>
    <div className="disc-fallback"><div className="disc-fallback-label"><Disc3 size={26}/><span>GROOVE</span><small>YOUR MUSIC. IN ORBIT.</small></div></div>
    {image && !failed && <img className="disc-art disc-art-enter" key={image} src={image} alt={`${title} album artwork`} onError={() => setFailed(true)}/>}
    {previous && <img className="disc-art disc-art-leave" src={previous} alt=""/>}
    <div className="disc-grooves"/><div className="disc-sheen"/><div className="disc-ring"/><div className="disc-hole"/>
  </div><div className="disc-glint"/></div>;
}
