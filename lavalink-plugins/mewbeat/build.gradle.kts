plugins {
    java
    alias(libs.plugins.lavalink)
}

group = "dev.mewbit"
version = "0.1.0"

lavalinkPlugin {
    name = "mewbeat"
    path = "dev.mewbit.mewbeat"
    apiVersion = libs.versions.lavalink.api
    serverVersion = libs.versions.lavalink.server
}

java {
    // The Lavalink image runs on a Java 18 runtime, so target 17 bytecode
    // regardless of the JDK doing the compiling.
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

tasks {
    test {
        useJUnitPlatform()
    }
    compileJava {
        options.encoding = "UTF-8"
        options.release = 17
    }
    processResources {
        // Exposes the Gradle project version to the plugin at runtime.
        val pluginVersion = project.version.toString()
        inputs.property("pluginVersion", pluginVersion)
        filesMatching("mewbeat.properties") {
            expand("version" to pluginVersion)
        }
    }
}

repositories {
    // The plugin-api artifacts are published here; the repository the Lavalink
    // gradle plugin registers by default no longer serves them.
    maven("https://maven.lavalink.dev/releases")
    mavenCentral()
}

dependencies {
    testImplementation(platform("org.junit:junit-bom:5.10.3"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
    // Lavalink provides Jackson at runtime; the tests only check the JSON shape.
    testImplementation("com.fasterxml.jackson.core:jackson-databind:2.17.2")
}
