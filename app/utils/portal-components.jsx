/**
 * Portal React components — kept in .jsx so Vite can parse JSX syntax.
 * Import from here instead of portal-theme.js for InstagramAvatar & FlagImg.
 */
import * as React from 'react';

// ── Country code map (mirrors the one in portal-theme.js) ────────────────────
const COUNTRY_CODES_MAP = {
  'Afghanistan':'af','Albania':'al','Algeria':'dz','Angola':'ao','Argentina':'ar',
  'Armenia':'am','Australia':'au','Austria':'at','Azerbaijan':'az','Bahrain':'bh',
  'Bangladesh':'bd','Belarus':'by','Belgium':'be','Bolivia':'bo','Bosnia and Herzegovina':'ba',
  'Brazil':'br','Bulgaria':'bg','Cambodia':'kh','Cameroon':'cm','Canada':'ca',
  'Chile':'cl','China':'cn','Colombia':'co','Costa Rica':'cr','Croatia':'hr',
  'Cuba':'cu','Cyprus':'cy','Czech Republic':'cz','Denmark':'dk','Dominican Republic':'do',
  'Ecuador':'ec','Egypt':'eg','El Salvador':'sv','Estonia':'ee','Ethiopia':'et',
  'Finland':'fi','France':'fr','Georgia':'ge','Germany':'de','Ghana':'gh',
  'Greece':'gr','Guatemala':'gt','Honduras':'hn','Hungary':'hu','Iceland':'is',
  'India':'in','Indonesia':'id','Iran':'ir','Iraq':'iq','Ireland':'ie',
  'Israel':'il','Italy':'it','Jamaica':'jm','Japan':'jp','Jordan':'jo',
  'Kazakhstan':'kz','Kenya':'ke','Kuwait':'kw','Latvia':'lv','Lebanon':'lb',
  'Lithuania':'lt','Luxembourg':'lu','Malaysia':'my','Mexico':'mx','Moldova':'md',
  'Morocco':'ma','Myanmar':'mm','Nepal':'np','Netherlands':'nl','New Zealand':'nz',
  'Nigeria':'ng','North Macedonia':'mk','Norway':'no','Pakistan':'pk','Panama':'pa',
  'Paraguay':'py','Peru':'pe','Philippines':'ph','Poland':'pl','Portugal':'pt',
  'Qatar':'qa','Romania':'ro','Russia':'ru','Saudi Arabia':'sa','Serbia':'rs',
  'Singapore':'sg','Slovakia':'sk','Slovenia':'si','South Africa':'za',
  'South Korea':'kr','Spain':'es','Sri Lanka':'lk','Sweden':'se','Switzerland':'ch',
  'Taiwan':'tw','Thailand':'th','Tunisia':'tn','Turkey':'tr','Ukraine':'ua',
  'United Arab Emirates':'ae','United Kingdom':'gb','United States':'us',
  'Uruguay':'uy','Uzbekistan':'uz','Venezuela':'ve','Vietnam':'vn',
  'Yemen':'ye','Zimbabwe':'zw',
};

// ── Instagram avatar — gradient initials with optional photo overlay ──────────
const AVATAR_GRADIENTS = [
  ['#7CFF6B','#4CD964'],
  ['#A855F7','#C084FC'],
  ['#3B82F6','#60A5FA'],
  ['#F59E0B','#FCD34D'],
  ['#EF4444','#F87171'],
  ['#14B8A6','#2DD4BF'],
  ['#EC4899','#F472B6'],
  ['#8B5CF6','#A78BFA'],
];

// Ordered list of avatar URL builders to try in sequence
function avatarSources(handle) {
  return [
    `https://unavatar.io/instagram/${encodeURIComponent(handle)}`,
    `https://unavatar.io/${encodeURIComponent(handle)}`,
  ];
}

export function InstagramAvatar({ handle, size = 36 }) {
  const clean    = (handle || '').replace(/^@/, '');
  const initials = clean.slice(0, 2).toUpperCase() || '?';
  const idx      = clean.split('').reduce((s, c) => s + c.charCodeAt(0), 0) % AVATAR_GRADIENTS.length;
  const [c1, c2] = AVATAR_GRADIENTS[idx];
  const fontSize = Math.round(size * 0.38);

  const sources = avatarSources(clean);
  const [srcIdx, setSrcIdx] = React.useState(0);
  const [visible, setVisible] = React.useState(false);

  // Reset when handle changes
  React.useEffect(() => { setSrcIdx(0); setVisible(false); }, [clean]);

  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: `linear-gradient(135deg, ${c1}, ${c2})`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize, fontWeight: '900', color: '#fff', letterSpacing: '-0.5px',
      overflow: 'hidden', position: 'relative',
    }}>
      {/* Fallback initials always rendered underneath */}
      <span style={{ position: 'relative', zIndex: 1, userSelect: 'none' }}>{initials}</span>

      {/* Profile photo overlay — tries each source in sequence */}
      {clean && srcIdx < sources.length && (
        <img
          key={srcIdx}
          src={sources[srcIdx]}
          alt=""
          onLoad={e => {
            const img = e.currentTarget;
            // Skip 1×1 placeholder GIFs that some proxies return on failure
            if (img.naturalWidth > 8 && img.naturalHeight > 8) {
              setVisible(true);
            } else {
              // Try next source
              setSrcIdx(i => i + 1);
            }
          }}
          onError={() => setSrcIdx(i => i + 1)}
          style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            objectFit: 'cover',
            opacity: visible ? 1 : 0,
            transition: 'opacity 0.25s ease',
            zIndex: 2,
          }}
        />
      )}
    </div>
  );
}

export function FlagImg({ country, size = 20 }) {
  const code = COUNTRY_CODES_MAP[country];
  if (!code) return null;
  return (
    <img
      src={`https://flagcdn.com/w40/${code}.png`}
      alt={country}
      width={size}
      height={Math.round(size * 0.75)}
      style={{ objectFit: 'cover', borderRadius: '2px', display: 'inline-block', verticalAlign: 'middle', flexShrink: 0 }}
      onError={e => { e.currentTarget.style.display = 'none'; }}
    />
  );
}
