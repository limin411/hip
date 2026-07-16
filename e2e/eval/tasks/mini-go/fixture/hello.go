package minigo

// Greet returns a greeting for name.
func Greet(name string) string {
	if name == "" {
		return "hello"
	}
	return "hello, " + name
}
