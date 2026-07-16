package minigo

import "testing"

func TestGreet(t *testing.T) {
	if Greet("world") != "hello, world" {
		t.Fatalf("Greet(world)=%q", Greet("world"))
	}
	if Greet("") != "hello" {
		t.Fatalf("Greet(empty)=%q", Greet(""))
	}
}
