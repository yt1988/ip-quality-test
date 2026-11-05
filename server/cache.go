package main

import (
	"container/list"
	"sync"
	"time"
)

// Cache: the most recently asked /24s, each for ttl; the oldest asked goes when it is full.
type Cache struct {
	mu  sync.Mutex
	max int
	ttl time.Duration
	ll  *list.List
	m   map[uint32]*list.Element
	now func() time.Time
}

type entry struct {
	k   uint32
	at  time.Time
	seg *Seg
}

func NewCache(max int, ttl time.Duration) *Cache {
	return &Cache{max: max, ttl: ttl, ll: list.New(), m: map[uint32]*list.Element{}, now: time.Now}
}

func (c *Cache) Get(k uint32) *Seg {
	c.mu.Lock()
	defer c.mu.Unlock()
	e := c.m[k]
	if e == nil {
		return nil
	}
	en := e.Value.(*entry)
	if c.now().Sub(en.at) > c.ttl {
		c.ll.Remove(e)
		delete(c.m, k)
		return nil
	}
	c.ll.MoveToFront(e)
	return en.seg
}

func (c *Cache) Put(k uint32, s *Seg) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if e := c.m[k]; e != nil {
		e.Value = &entry{k, c.now(), s}
		c.ll.MoveToFront(e)
		return
	}
	c.m[k] = c.ll.PushFront(&entry{k, c.now(), s})
	for c.ll.Len() > c.max {
		old := c.ll.Back()
		c.ll.Remove(old)
		delete(c.m, old.Value.(*entry).k)
	}
}

// Limiter: at most n new /24s per client address per window (cached ones are free). Counts live in memory only and
// are dropped as their window ends.
type Limiter struct {
	mu  sync.Mutex
	n   int
	win time.Duration
	m   map[string]*bucket
	now func() time.Time
}

type bucket struct {
	start time.Time
	used  int
}

func NewLimiter(n int, win time.Duration) *Limiter {
	return &Limiter{n: n, win: win, m: map[string]*bucket{}, now: time.Now}
}

func (l *Limiter) Allow(who string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	if len(l.m) > 10000 {
		for k, b := range l.m {
			if now.Sub(b.start) > l.win {
				delete(l.m, k)
			}
		}
	}
	b := l.m[who]
	if b == nil || now.Sub(b.start) > l.win {
		b = &bucket{start: now}
		l.m[who] = b
	}
	if b.used >= l.n {
		return false
	}
	b.used++
	return true
}
