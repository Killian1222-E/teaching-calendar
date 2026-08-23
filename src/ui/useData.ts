import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo } from 'react'
import { db, getSettings } from '../db/local'
import {
  allCourses, allGroups, allLessons, allLocations, allPatterns, allStudents,
} from '../db/repo'
import type { Course, Group, Lesson, Location, Pattern, Settings, Student } from '../db/types'
import { todayStr } from '../lib/date'
import type { ParseContext } from '../nlp/types'

export function useLocations(): Location[] {
  return useLiveQuery(() => allLocations(), [], [] as Location[])
}
export function useCourses(): Course[] {
  return useLiveQuery(() => allCourses(), [], [] as Course[])
}
export function useGroups(): Group[] {
  return useLiveQuery(() => allGroups(), [], [] as Group[])
}
export function usePatterns(): Pattern[] {
  return useLiveQuery(() => allPatterns(), [], [] as Pattern[])
}
export function useLessons(): Lesson[] {
  return useLiveQuery(() => allLessons(), [], [] as Lesson[])
}
export function useStudents(): Student[] {
  return useLiveQuery(() => allStudents(), [], [] as Student[])
}
export function useSettings(): Settings | undefined {
  return useLiveQuery(() => getSettings(), [])
}

export interface AppData {
  locations: Location[]
  courses: Course[]
  groups: Group[]
  patterns: Pattern[]
  lessons: Lesson[]
  students: Student[]
  settings?: Settings
  nameOf: {
    location: (id?: string) => string
    course: (id?: string) => string
    group: (id?: string) => string
  }
  colorOf: {
    course: (id?: string) => string
    location: (id?: string) => string
  }
  studentsOf: (groupId?: string) => Student[]
  ctx: ParseContext
}

export function useAppData(): AppData {
  const locations = useLocations()
  const courses = useCourses()
  const groups = useGroups()
  const patterns = usePatterns()
  const lessons = useLessons()
  const students = useStudents()
  const settings = useSettings()

  return useMemo(() => {
    const lmap = new Map(locations.map((x) => [x.id, x]))
    const cmap = new Map(courses.map((x) => [x.id, x]))
    const gmap = new Map(groups.map((x) => [x.id, x]))
    return {
      locations, courses, groups, patterns, lessons, students, settings,
      nameOf: {
        location: (id?: string) => (id && lmap.get(id)?.name) || '',
        course: (id?: string) => (id && cmap.get(id)?.name) || '',
        group: (id?: string) => (id && gmap.get(id)?.name) || '',
      },
      colorOf: {
        course: (id?: string) => (id && cmap.get(id)?.color) || 'var(--text-faint)',
        location: (id?: string) => (id && lmap.get(id)?.color) || 'var(--text-faint)',
      },
      studentsOf: (groupId?: string) =>
        groupId
          ? students.filter((s) => s.group_id === groupId && s.active)
              .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'))
          : [],
      ctx: {
        today: todayStr(),
        defaultMinutes: settings?.default_lesson_minutes ?? 90,
        locations, courses, groups, patterns, lessons,
      },
    }
  }, [locations, courses, groups, patterns, lessons, students, settings])
}

export async function countAll(): Promise<Record<string, number>> {
  return {
    locations: await db.locations.filter((x) => !x.deleted).count(),
    courses: await db.courses.filter((x) => !x.deleted).count(),
    groups: await db.groups.filter((x) => !x.deleted).count(),
    students: await db.students.filter((x) => !x.deleted).count(),
    patterns: await db.patterns.filter((x) => !x.deleted).count(),
    lessons: await db.lessons.filter((x) => !x.deleted).count(),
  }
}
