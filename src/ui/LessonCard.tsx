import { progressFor } from '../db/repo'
import type { Lesson } from '../db/types'
import { durationLabel, formatDateShort } from '../lib/date'
import { eventScale, rosterOf } from '../lib/roster'
import { IconUsers } from './icons'
import type { AppData } from './useData'

export function LessonCard({
  lesson, data, onClick, onPeekRoster, showPrev = true,
}: {
  lesson: Lesson
  data: AppData
  onClick?: () => void
  /** 點人數徽章時打開名單快捷視窗 */
  onPeekRoster?: (lesson: Lesson) => void
  showPrev?: boolean
}) {
  const isEvent = lesson.kind === 'event'
  const course = data.nameOf.course(lesson.course_id)
  const group = data.nameOf.group(lesson.group_id)
  const loc = data.nameOf.location(lesson.location_id)
  const prog = showPrev && !isEvent ? progressFor(lesson, data.lessons) : null
  const color = isEvent ? 'var(--sub)' : data.colorOf.course(lesson.course_id)
  const roster = rosterOf(lesson, data.studentsOf)
  const scale = isEvent ? eventScale(roster.count) : null

  const cls = [
    'lesson',
    isEvent ? 'event' : '',
    lesson.status === 'cancelled' ? 'cancelled' : '',
    lesson.status === 'done' ? 'done' : '',
  ].join(' ')

  const title = isEvent
    ? (lesson.title || course || '大活動')
    : (course || '未命名課程')

  // 同一班每週課程可能不同：同一門課的進度與上一次見面分開顯示
  const sameCourse = prog?.sameCourse
  const lastMeeting = prog?.lastMeeting
  const showBoth =
    !!sameCourse && !!lastMeeting &&
    !(lastMeeting.date === sameCourse.date && lastMeeting.topic === sameCourse.topic)

  return (
    <div
      className={cls}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.() } }}
    >
      <span className="bar" style={{ background: color }} />
      <div className="body">
        <div className="l-time">
          {lesson.start_time}–{lesson.end_time}
          <span className="faint" style={{ fontWeight: 400 }}>
            {' '}· {durationLabel(lesson.start_time, lesson.end_time)}
          </span>
        </div>

        <div className="l-title">
          {isEvent && <span className="chip sub" style={{ marginRight: 6, verticalAlign: 2 }}>大活動</span>}
          {title}
        </div>

        <div className="l-meta">
          {roster.count > 0 || group ? (
            <button
              className={'chip roster-btn ' + (isEvent ? (scale!.tone === 'danger' ? 'danger' : scale!.tone) : 'accent')}
              onClick={(e) => { e.stopPropagation(); onPeekRoster?.(lesson) }}
              title="看名單"
            >
              <IconUsers size={13} />
              {group || (isEvent ? '參加者' : '臨時名單')}
              <span style={{ opacity: .75 }}>· {roster.count}人</span>
            </button>
          ) : null}
          {isEvent && course && <span>{course}</span>}
          {loc && <span>📍 {loc}</span>}
          {lesson.is_substitute ? (
            <span className="chip sub">代課{lesson.substitute_for ? `・${lesson.substitute_for}` : ''}</span>
          ) : null}
          {lesson.status === 'cancelled' && <span className="chip danger">{isEvent ? '已取消' : '已停課'}</span>}
          {lesson.status === 'done' && <span className="chip ok">已完成</span>}
        </div>

        {lesson.topic && <div className="l-topic">本堂：{lesson.topic}</div>}

        {!lesson.topic && sameCourse && (
          <div className="l-prev">
            {course ? `${course} 上次上到 ` : '上次上到 '}
            <b>{sameCourse.topic}</b>
            {sameCourse.date && <span className="faint">・{formatDateShort(sameCourse.date)}</span>}
          </div>
        )}
        {!lesson.topic && showBoth && (
          <div className="l-prev" style={{ opacity: .85 }}>
            上一次見面（{data.nameOf.course(lastMeeting!.course_id) || '其他課程'}）上到 <b>{lastMeeting!.topic}</b>
            {lastMeeting!.date && <span className="faint">・{formatDateShort(lastMeeting!.date)}</span>}
          </div>
        )}
        {!lesson.topic && !sameCourse && lastMeeting && (
          <div className="l-prev">
            上次上到 <b>{lastMeeting.topic}</b>
            {lastMeeting.date && <span className="faint">・{formatDateShort(lastMeeting.date)}</span>}
          </div>
        )}

        {lesson.note && <div className="tiny faint">{lesson.note}</div>}
      </div>
    </div>
  )
}
