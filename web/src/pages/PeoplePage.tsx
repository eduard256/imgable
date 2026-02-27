import { useState, useEffect, useRef, useCallback } from 'react'
import { apiFetch } from '../lib/api'
import { t } from '../lib/i18n'

// ============================================================
// People Page — Grid of detected faces, groups section below
//
// Square avatar cards in responsive grid.
// Tap person → PersonPage.
// Groups section ("Together") below individuals.
// Infinite scroll for both sections.
// ============================================================

interface Person {
  id: string
  name: string
  name_source: 'manual' | 'auto'
  photo_count: number
  face_url: string
  face_box: { x: number; y: number; w: number; h: number }
}

interface Group {
  person_ids: string[]
  names: string[]
  photo_count: number
  face_urls: string[]
}

const PAGE_LIMIT = 30

export default function PeoplePage({ onBack, onOpenPerson, onOpenGroup }: {
  onBack: () => void
  onOpenPerson: (id: string) => void
  onOpenGroup: (ids: string[]) => void
}) {
  const [people, setPeople] = useState<Person[]>([])
  const [groups, setGroups] = useState<Group[]>([])
  const [peopleTotal, setPeopleTotal] = useState(0)
  const [groupsTotal, setGroupsTotal] = useState(0)
  const [peopleHasMore, setPeopleHasMore] = useState(false)
  const [groupsHasMore, setGroupsHasMore] = useState(false)

  const peopleOffsetRef = useRef(0)
  const groupsOffsetRef = useRef(0)
  const loadingPeopleRef = useRef(false)
  const loadingGroupsRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  const loadPeople = useCallback(async (offset: number) => {
    if (loadingPeopleRef.current) return
    loadingPeopleRef.current = true
    try {
      const res = await apiFetch(`/api/v1/people?limit=${PAGE_LIMIT}&offset=${offset}`)
      if (!res.ok) return
      const data = await res.json()
      setPeopleTotal(data.total)
      setPeople(prev => offset === 0 ? data.people : [...prev, ...data.people])
      setPeopleHasMore(data.has_more)
      peopleOffsetRef.current = offset + data.people.length
    } finally {
      loadingPeopleRef.current = false
    }
  }, [])

  const loadGroups = useCallback(async (offset: number) => {
    if (loadingGroupsRef.current) return
    loadingGroupsRef.current = true
    try {
      const res = await apiFetch(`/api/v1/people/groups?limit=${PAGE_LIMIT}&offset=${offset}`)
      if (!res.ok) return
      const data = await res.json()
      setGroupsTotal(data.total)
      setGroups(prev => offset === 0 ? data.groups : [...prev, ...data.groups])
      setGroupsHasMore(data.has_more)
      groupsOffsetRef.current = offset + data.groups.length
    } finally {
      loadingGroupsRef.current = false
    }
  }, [])

  // Initial load
  useEffect(() => {
    loadPeople(0)
    loadGroups(0)
  }, [loadPeople, loadGroups])

  // Infinite scroll
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 800
    if (nearBottom) {
      if (peopleHasMore && !loadingPeopleRef.current) {
        loadPeople(peopleOffsetRef.current)
      }
      if (groupsHasMore && !loadingGroupsRef.current) {
        loadGroups(groupsOffsetRef.current)
      }
    }
  }, [peopleHasMore, groupsHasMore, loadPeople, loadGroups])

  return (
    <div className="fixed inset-0 z-30" style={{ background: 'rgba(10, 7, 5, 0.97)' }}>
      {/* Header */}
      <div
        className="flex items-center gap-3"
        style={{
          padding: '16px 16px 12px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
        }}
      >
        <button
          onClick={onBack}
          className="flex items-center justify-center"
          style={{
            width: '36px',
            height: '36px',
            borderRadius: '12px',
            background: 'rgba(255, 255, 255, 0.08)',
            border: 'none',
            cursor: 'pointer',
            color: 'rgba(255, 255, 255, 0.7)',
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </button>
        <span style={{
          color: 'rgba(255, 255, 255, 0.9)',
          fontSize: '18px',
          fontWeight: 400,
          letterSpacing: '0.3px',
        }}>
          {t('people')}
        </span>
        <span style={{
          color: 'rgba(255, 255, 255, 0.35)',
          fontSize: '14px',
          fontWeight: 300,
        }}>
          {peopleTotal}
        </span>
      </div>

      {/* Scrollable content */}
      <div
        ref={scrollRef}
        className="overflow-y-auto"
        style={{ height: 'calc(100% - 65px)' }}
        onScroll={handleScroll}
      >
        {/* People grid */}
        {people.length === 0 ? (
          <div style={{
            padding: '60px 20px',
            textAlign: 'center',
            color: 'rgba(255, 255, 255, 0.3)',
            fontSize: '14px',
          }}>
            {t('no_people')}
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
              gap: '12px',
              padding: '16px',
            }}
          >
            {people.map((person) => (
              <PersonCard
                key={person.id}
                person={person}
                onClick={() => onOpenPerson(person.id)}
              />
            ))}
          </div>
        )}

        {/* Groups section */}
        {groups.length > 0 && (
          <div style={{ marginTop: '8px' }}>
            {/* Section header */}
            <div
              className="flex items-center gap-2"
              style={{
                padding: '12px 16px 8px',
                borderTop: '1px solid rgba(255, 255, 255, 0.06)',
              }}
            >
              <span style={{
                color: 'rgba(255, 255, 255, 0.85)',
                fontSize: '17px',
                fontWeight: 400,
                letterSpacing: '0.5px',
              }}>
                {t('together')}
              </span>
              <span style={{
                color: 'rgba(255, 255, 255, 0.35)',
                fontSize: '14px',
                fontWeight: 300,
              }}>
                {groupsTotal}
              </span>
            </div>

            {/* Groups grid */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                gap: '12px',
                padding: '8px 16px 24px',
              }}
            >
              {groups.map((group, idx) => (
                <GroupCard
                  key={idx}
                  group={group}
                  onClick={() => onOpenGroup(group.person_ids)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// Individual person card — square avatar + optional name
function PersonCard({ person, onClick }: { person: Person; onClick: () => void }) {
  const box = person.face_box
  const scale = 1 / Math.max(box.w, box.h) * 0.75

  return (
    <div
      className="flex flex-col items-center cursor-pointer"
      onClick={onClick}
      style={{ gap: '6px' }}
    >
      <div
        className="relative overflow-hidden w-full"
        style={{
          aspectRatio: '1',
          borderRadius: '16px',
          backgroundColor: 'rgba(255, 255, 255, 0.06)',
        }}
      >
        <img
          src={person.face_url}
          alt=""
          loading="lazy"
          decoding="async"
          className="transition-transform duration-200"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: `${(box.x + box.w / 2) * 100}% ${(box.y + box.h / 2) * 100}%`,
            transform: `scale(${scale})`,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.transform = `scale(${scale * 1.05})`
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.transform = `scale(${scale})`
          }}
        />
        {/* Photo count badge */}
        <div
          style={{
            position: 'absolute',
            bottom: '6px',
            right: '6px',
            background: 'rgba(0, 0, 0, 0.55)',
            backdropFilter: 'blur(4px)',
            borderRadius: '8px',
            padding: '2px 6px',
            fontSize: '11px',
            color: 'rgba(255, 255, 255, 0.75)',
            fontWeight: 300,
          }}
        >
          {person.photo_count}
        </div>
      </div>
      {/* Name — only for manually named */}
      {person.name_source === 'manual' && (
        <span style={{
          fontSize: '12px',
          color: 'rgba(255, 255, 255, 0.7)',
          fontWeight: 300,
          textAlign: 'center',
          lineHeight: '1.3',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          width: '100%',
        }}>
          {person.name}
        </span>
      )}
    </div>
  )
}

// Group card — overlapping avatars + name
function GroupCard({ group, onClick }: { group: Group; onClick: () => void }) {
  // Format group display name
  const known = group.names.filter(n => !n.startsWith('Unknown '))
  const unknownCount = group.names.length - known.length
  let displayName: string
  if (known.length === 0) {
    displayName = `${unknownCount} ${unknownCount === 1 ? 'person' : 'people'}`
  } else if (unknownCount === 0) {
    displayName = known.join(', ')
  } else {
    displayName = `${known.join(', ')} +${unknownCount}`
  }

  return (
    <div
      className="cursor-pointer"
      onClick={onClick}
      style={{
        background: 'rgba(255, 255, 255, 0.04)',
        borderRadius: '16px',
        padding: '12px',
        border: '1px solid rgba(255, 255, 255, 0.06)',
      }}
    >
      {/* Overlapping face thumbnails */}
      <div className="flex" style={{ marginBottom: '8px' }}>
        {group.face_urls.slice(0, 3).map((url, i) => (
          <div
            key={i}
            className="overflow-hidden"
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              border: '2px solid rgba(10, 7, 5, 0.97)',
              marginLeft: i > 0 ? '-8px' : '0',
              zIndex: 3 - i,
              position: 'relative',
              backgroundColor: 'rgba(255, 255, 255, 0.08)',
            }}
          >
            <img
              src={url}
              alt=""
              loading="lazy"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          </div>
        ))}
        {group.person_ids.length > 3 && (
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: '10px',
            border: '2px solid rgba(10, 7, 5, 0.97)',
            marginLeft: '-8px',
            background: 'rgba(255, 255, 255, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '11px',
            color: 'rgba(255, 255, 255, 0.6)',
          }}>
            +{group.person_ids.length - 3}
          </div>
        )}
      </div>
      <div style={{
        fontSize: '12px',
        color: 'rgba(255, 255, 255, 0.7)',
        fontWeight: 300,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>
        {displayName}
      </div>
      <div style={{
        fontSize: '11px',
        color: 'rgba(255, 255, 255, 0.35)',
        fontWeight: 300,
        marginTop: '2px',
      }}>
        {group.photo_count} {t('photos').toLowerCase()}
      </div>
    </div>
  )
}
