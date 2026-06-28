import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { findProject } from '../lib/project'

let root: string

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dibs-proj-'))
  fs.mkdirSync(path.join(root, '.dibs'))
})
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

const write = (name: string, id: string) =>
  fs.writeFileSync(path.join(root, '.dibs', name), JSON.stringify({ projectId: id }))

describe('findProject', () => {
  it('returns null when nothing is set up', () => {
    expect(findProject(root)).toBeNull()
  })

  it('reads the committed project.json', () => {
    write('project.json', 'shared')
    expect(findProject(root)).toEqual({ projectId: 'shared' })
  })

  it('parses joinCode when present', () => {
    fs.writeFileSync(
      path.join(root, '.dibs', 'project.json'),
      JSON.stringify({ projectId: 'p1', joinCode: 'abc' })
    )
    expect(findProject(root)).toEqual({ projectId: 'p1', joinCode: 'abc' })
  })

  it('local override wins over the committed file', () => {
    write('project.json', 'shared')
    write('project.local.json', 'personal')
    expect(findProject(root)).toEqual({ projectId: 'personal' })
  })

  it('falls back to committed when the local override is malformed', () => {
    write('project.json', 'shared')
    fs.writeFileSync(path.join(root, '.dibs', 'project.local.json'), '{ not json')
    expect(findProject(root)).toEqual({ projectId: 'shared' })
  })

  it('walks up to a parent directory', () => {
    write('project.json', 'shared')
    const nested = path.join(root, 'a', 'b')
    fs.mkdirSync(nested, { recursive: true })
    expect(findProject(nested)).toEqual({ projectId: 'shared' })
  })
})
